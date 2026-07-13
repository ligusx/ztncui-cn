/*
  ztncui - ZeroTier network controller UI
  Copyright (C) 2017-2021  Key Networks (https://key-networks.com)
  Licensed under GPLv3 - see LICENSE for details.
*/

const fs = require('fs');
const ipaddr = require('ip-address');
const storage = require('node-persist');
const zt = require('./zt');
const util = require('util');

storage.initSync({dir: 'etc/storage'});

async function get_network_with_members(nwid) {
  const [network, peers, members] = await Promise.all([
    zt.network_detail(nwid),
    zt.peers(),
    zt.members(nwid)
      .then(member_ids => {
        // 修复 ZeroTier 1.12 返回的异常数据
        if (Array.isArray(member_ids)) {
          let obj = {};
          for (let id of member_ids) {
            let key = Object.keys(id)[0];
            let value = Object.values(id)[0];
            obj[key] = value;
          }
          member_ids = obj;
        }

        return Promise.all(
          Object.keys(member_ids)
            .map(id => Promise.all([
              zt.member_detail(nwid, id),
              storage.getItem(id)
            ]))
        );
      }).then(results => results.map(([member, name]) => {
        member.name = name || '';
        return member;
      }))
  ]);
  for (const member of members) {
    member.peer = peers.find(x => x.address === member.address);
  }
  return {network, members};
}

async function get_network_member(nwid, memberid) {
  const [network, member, peer, name] = await Promise.all([
    zt.network_detail(nwid),
    zt.member_detail(nwid, memberid),
    zt.peer(memberid),
    storage.getItem(memberid)
  ]);
  member.name = name || '';
  member.peer = peer;
  return {network, member};
}

// ZT 网络控制器首页
exports.index = async function(req, res) {
  const navigate =
    {
      active: 'controller_home',
    }

  try {
    const zt_status = await zt.get_zt_status();
    res.render('index', {title: 'ztncui', navigate: navigate, zt_status});
  } catch (err) {
    res.render('index', {title: 'ztncui',
                      navigate: navigate, error: '获取 ZT 状态时出错：' + err});
  }
};

// 显示此 ZT 网络控制器上的所有网络列表
exports.network_list = async function(req, res) {
  const navigate =
    {
      active: 'networks',
    }

  try {
    networks = await zt.network_list();
    res.render('networks', {title: '此控制器上的网络', navigate: navigate, networks: networks});
  } catch (err) {
    res.render('networks', {title: '此控制器上的网络', navigate: navigate, error: '获取此控制器上的网络列表时出错：' + err});
  }
};

// 显示特定网络的详情页面
exports.network_detail = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  try {
    const [
      {network, members},
      zt_address
    ] = await Promise.all([
      get_network_with_members(req.params.nwid),
      zt.get_zt_address()
    ]);
    res.render('network_detail', {title: '网络 ' + network.name, navigate: navigate, network: network, members: members, zt_address: zt_address});
  } catch (err) {
    res.render('network_detail', {title: '网络详情', navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 的详情时出错：' + err});
  }
};

// GET 显示创建网络表单
exports.network_create_get = function(req, res) {
  const navigate =
    {
      active: 'add_network',
    }

  res.render('network_create', {title: '创建网络', navigate: navigate});
};

// POST 处理创建网络
exports.network_create_post = async function(req, res) {
  const navigate =
    {
      active: 'add_network',
    }

  req.checkBody('name', '请输入网络名称').notEmpty();

  req.sanitize('name').escape();
  req.sanitize('name').trim();

  const errors = req.validationErrors();

  let name = { name: req.body.name };

  if (errors) {
    res.render('network_create', {title: '创建网络', navigate: navigate, name: name, errors: errors});
    return;
  } else {
    try {
      const network = await zt.network_create(name);
      res.redirect('/controller/network/' + network.nwid);
    } catch (err) {
      res.render('network_detail', {title: '创建网络 - 出错', navigate: navigate, error: '创建网络 ' + name.name + ' 时出错'});
    }
  }
};

// GET 显示删除网络表单
exports.network_delete_get = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
    res.render('network_delete', {title: '删除网络', navigate: navigate,
                                    nwid: req.params.nwid, network: network});
  } catch (err) {
    res.render('network_delete', {title: '删除网络', navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 时出错：' + err});
  }
};

// POST 处理删除网络
exports.network_delete_post = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  try {
    const network = await zt.network_delete(req.params.nwid);
    res.render('network_delete', {title: '删除网络', navigate: navigate, network: network});
  } catch (err) {
    res.render('network_delete', {title: '删除网络', navigate: navigate, error: '删除网络 ' + req.params.nwid + ' 时出错：' + err});
  }
};

// GET 网络对象
exports.network_object = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render(req.params.object, {title: req.params.object, navigate: navigate, network: network}, function(err, html) {
      if (err) {
        if (err.message.indexOf('Failed to lookup view') !== -1 ) {
          return res.render('not_implemented', {title: req.params.object, navigate: navigate, network: network});
        }
        throw err;
      }
      res.send(html);
    });
  } catch (err) {
    res.render(req.params.object, {title: req.params.object, navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 的详情时出错：' + err});
  }
}

// POST 处理网络重命名
exports.name = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  req.checkBody('name', '请输入网络名称').notEmpty();
  req.sanitize('name').escape();
  req.sanitize('name').trim();

  const errors = req.validationErrors();

  let name = { name: req.body.name };

  if (errors) {
    console.error("网络名称验证错误", errors);
  } else {
    try {
      const network = await zt.network_object(req.params.nwid, name);
    } catch ( err) {
      console.error("重命名网络 " + req.params.nwid + " 时出错", err);
    }
  }
  res.redirect('/controller/network/' + req.params.nwid);
};

// POST ipAssignmentPools
exports.ipAssignmentPools = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  req.checkBody('ipRangeStart', '请输入 IP 范围起始地址').notEmpty();
  req.checkBody('ipRangeStart', 'IP 范围起始地址必须是有效的 IPv4 或 IPv6 地址').isIP();
  req.sanitize('ipRangeStart').escape();
  req.sanitize('ipRangeStart').trim();
  req.checkBody('ipRangeEnd', '请输入 IP 范围结束地址').notEmpty();
  req.checkBody('ipRangeEnd', 'IP 范围结束地址必须是有效的 IPv4 或 IPv6 地址').isIP();
  req.sanitize('ipRangEnd').escape();
  req.sanitize('ipRangEnd').trim();

  const errors = req.validationErrors();

  const ipAssignmentPool =
    {
      ipRangeStart: req.body.ipRangeStart,
      ipRangeEnd: req.body.ipRangeEnd
    };

  if (errors) {
    try {
      const network = await zt.network_detail(req.params.nwid);
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('ipAssignmentPools', {title: 'IP 分配池', navigate: navigate, ipAssignmentPool: ipAssignmentPool, network: network, errors: errors});
    } catch (err) {
      res.render('ipAssignmentPools', {title: 'IP 分配池', navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 详情时出错：' + err});
    }
  } else {
    try {
      const network = await zt.ipAssignmentPools(req.params.nwid, ipAssignmentPool, 'add');
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('ipAssignmentPools', {title: 'IP 分配池', navigate: navigate, ipAssignmentPool: ipAssignmentPool, network: network});
    } catch (err) {
      res.render('ipAssignmentPools', {title: 'IP 分配池', navigate: navigate, error: '为网络 ' + req.params.nwid + ' 应用 IP 分配池时出错：' + err});
    }
  }
}

isValidPrefix = function(str, max) {
  const num = Math.floor(Number(str));
  return String(num) == str && num >= 0 && num <= max;
}

// POST routes
exports.routes = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  req.checkBody('target', '请输入目标网络').notEmpty();
  req.sanitize('target').trim();
  req.checkBody('target', '目标网络必须是有效的 CIDR 格式')
    .custom(value => {
      const parts = value.split('/');
      const ipv4 = new ipaddr.Address4(parts[0]);
      const ipv6 = new ipaddr.Address6(parts[0]);
      let isValidIPv4orIPv6 = false;
      let prefixMax = 32;
      if (ipv4.isValid()) {
        isValidIPv4orIPv6 = true;
      } else {
      }
      if (ipv6.isValid()) {
        isValidIPv4orIPv6 = true;
        prefixMax = 128;
      } else {
      }
      return isValidIPv4orIPv6 && isValidPrefix(parts[1], prefixMax);
    });
  req.checkBody('via', '网关必须是有效的 IPv4 或 IPv6 地址').optional({ checkFalsy: true }).isIP();
  req.sanitize('via').escape();
  req.sanitize('via').trim();
  if (! req.body.via) {
    req.body.via = null;
  }

  const errors = req.validationErrors();

  const route =
    {
      target: req.body.target,
      via: req.body.via
    };

  if (errors) {
    try {
      const network = await zt.network_detail(req.params.nwid);
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('routes', {title: '路由', navigate: navigate, route: route, network: network, errors: errors});
    } catch (err) {
      res.render('routes', {title: '路由', navigate: navigate, error: '获取网络详情时出错'});
    }
  } else {
    try {
      const network = await zt.routes(req.params.nwid, route, 'add');
      navigate.whence = '/controller/network/' + network.nwid;
      res.render('routes', {title: '路由', navigate: navigate, route: route, network: network});
    } catch (err) {
      res.render('routes', {title: '路由', navigate: navigate, error: '为网络 ' + req.params.nwid + ' 添加路由时出错：' + err});
    }
  }

}

// GET route_delete
exports.route_delete = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const route =
    {
      target: req.params.target_ip + '/' + req.params.target_prefix,
      via: null
    };


  try {
    const network = await zt.routes(req.params.nwid, route, 'delete');
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('routes', {title: '路由', navigate: navigate, route: route, network: network});
  } catch (err) {
    res.render('routes', {title: '路由', navigate: navigate, error: '删除网络 ' + req.params.nwid + ' 的路由时出错：' + err});
  }
}

// GET ipAssignmentPool_delete
exports.ipAssignmentPool_delete = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const ipAssignmentPool =
    {
      ipRangeStart: req.params.ipRangeStart,
      ipRangeEnd: req.params.ipRangeEnd
    };


  try {
    const network = await zt.ipAssignmentPools(req.params.nwid, ipAssignmentPool, 'delete');
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('ipAssignmentPools', {title: 'IP 分配池', navigate: navigate, ipAssignmentPool: ipAssignmentPool, network: network});
  } catch (err) {
    res.render('ipAssignmentPools', {title: 'IP 分配池', navigate: navigate, error: '删除网络 ' + req.params.nwid + ' 的 IP 分配池时出错：' + err});
  }
}

// POST private
exports.private = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const private =
    {
      private: req.body.private
    };

  try {
    const network = await zt.network_object(req.params.nwid, private);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('private', {title: '公/私有网络', navigate: navigate, network: network});
  } catch (err) {
    res.render('private', {title: '公/私有网络', navigate: navigate, error: '为网络 ' + req.params.nwid + ' 应用私有设置时出错：' + err});
  }
}

// POST v4AssignMode
exports.v4AssignMode = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const v4AssignMode =
    {
      v4AssignMode: { zt: req.body.zt }
    };

  try {
    const network = await zt.network_object(req.params.nwid, v4AssignMode);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('v4AssignMode', {title: 'IPv4 分配模式', navigate: navigate, network: network});
  } catch (err) {
    res.render('v4AssignMode', {title: 'IPv4 分配模式', navigate: navigate, error: '为网络 ' + req.params.nwid + ' 应用 v4AssignMode 时出错：' + err});
  }
}

// POST v6AssignMode
exports.v6AssignMode = async function (req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  const v6AssignMode =
    {
      v6AssignMode:
        {
          '6plane': req.body['6plane'],
          'rfc4193': req.body.rfc4193,
          'zt': req.body.zt
        }
    };

  try {
    const network = await zt.network_object(req.params.nwid, v6AssignMode);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('v6AssignMode', {title: 'IPv6 分配模式', navigate: navigate, network: network});
  } catch (err) {
    res.render('v6AssignMode', {title: 'IPv6 分配模式', navigate: navigate, error: '为网络 ' + req.params.nwid + ' 应用 v6AssignMode 时出错：' + err});
  }
}

// POST dns
exports.dns = async function (req, res) {
  const navigate = {
    active: 'networks',
    whence: ''
  };

  const dns = {
    dns: {
      domain: req.body.domain,
      servers: req.body.servers
        .split('\n')
        .map(x => x.trim())
        .filter(ip =>
          new ipaddr.Address4(ip).isValid() ||
          new ipaddr.Address6(ip).isValid()
        )
    }
  };

  try {
    const network = await zt.network_object(req.params.nwid, dns);
    navigate.whence = '/controller/network/' + network.nwid;
    res.render('dns', {title: 'DNS', navigate: navigate, network: network});
  } catch (err) {
    res.render('dns', {title: 'DNS', navigate: navigate, error: '为网络 ' + req.params.nwid + ' 更新 DNS 时出错：' + err});
  }
}

// 显示特定成员的详情页面
exports.member_detail = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const {network, member} = await get_network_member(req.params.nwid, req.params.id);
    navigate.whence = '/controller/network/' + network.nwid + '#members';
    res.render('member_detail', {title: '网络成员详情', navigate: navigate, network: network, member: member});
  } catch (err) {
    console.error(err);
    res.render('error', {title: req.params.object, navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 的成员 ' + req.params.id + ' 详情时出错：' + err});
  }
};

// GET 成员对象
exports.member_object = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const {network, member} = await get_network_member(req.params.nwid, req.params.id);
    navigate.whence = '/controller/network/' + network.nwid + '#members';
    res.render(req.params.object, {title: req.params.object, navigate: navigate, network: network, member: member}, function(err, html) {
      if (err) {
        if (err.message.indexOf('Failed to lookup view') !== -1 ) {
          return res.render('not_implemented', {title: req.params.object, navigate: navigate, network: network, member: member});
        }
        throw err;
      }
      res.send(html);
    });
  } catch (err) {
    res.render(req.params.object, {title: req.params.object, navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 的成员 ' + req.params.id + ' 详情时出错：' + err});
  }
}

// GET Easy network setup
exports.easy_get = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/network/' + req.params.nwid
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
    res.render('network_easy', {title: '网络快速设置', navigate: navigate, network: network});
  } catch (err) {
    res.render('network_easy', {title: '网络快速设置', navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 详情时出错：' + err});
  }
}

// POST Easy network setup
exports.easy_post = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  req.checkBody('networkCIDR', '请输入网络地址').notEmpty();
  req.sanitize('networkCIDR').trim();
  req.checkBody('networkCIDR', '网络地址必须是 CIDR 格式')
    .custom(value => {
      const parts = value.split('/');
      const ipv4 = new ipaddr.Address4(parts[0]);
      return ipv4.isValid() && isValidPrefix(parts[1], 32);
    });
  req.checkBody('poolStart', '请输入 IP 分配池起始地址')
    .notEmpty();
  req.checkBody('poolStart', 'IP 分配池起始地址必须是有效的 IPv4 地址')
    .isIP(4);
  req.sanitize('poolStart').escape();
  req.sanitize('poolStart').trim();
  req.checkBody('poolEnd', '请输入 IP 分配池结束地址')
    .notEmpty();
  req.checkBody('poolEnd', 'IP 分配池结束地址必须是有效的 IPv4 地址')
    .isIP(4);
  req.sanitize('poolEnd').escape();
  req.sanitize('poolEnd').trim();

  const errors = req.validationErrors();

  const ipAssignmentPools =
    [{
      ipRangeStart: req.body.poolStart,
      ipRangeEnd: req.body.poolEnd
    }];

  const routes =
    [{
      target: req.body.networkCIDR,
      via: null
    }];

  const v4AssignMode =
    {
      zt: true
    };

  if (errors) {
    network =
      {
        ipAssignmentPools: ipAssignmentPools,
        routes: routes,
        v4AssignMode: v4AssignMode
      };

    res.render('network_easy', {title: '网络快速设置', navigate: navigate, network: network, errors: errors});
  } else {
    try {
      const network = await zt.network_easy_setup(req.params.nwid,
                                                  routes,
                                                  ipAssignmentPools,
                                                  v4AssignMode);
      res.render('network_easy', {title: '网络快速设置', navigate: navigate, network: network, message: '网络设置成功'});
    } catch (err) {
      res.render('network_easy', {title: '网络快速设置', navigate: navigate, error: '获取网络 ' + req.params.nwid + ' 详情时出错：' + err});
    }
  }
}

// POST members auth
exports.members = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: '/controller/networks'
    }

  let errors = null;

  if (req.method === 'POST') {

    req.checkBody('id', '请输入成员 ID').notEmpty();
    req.sanitize('id').trim();
    req.sanitize('id').escape();

    if (req.body.auth) {
      req.checkBody('auth', '授权状态必须是布尔值').isBoolean();
      req.sanitize('auth').trim();
      req.sanitize('auth').escape();

      errors = req.validationErrors();

      if (!errors) {
        const auth =
          {
            authorized: req.body.auth
          };

        try {
          const mem = await zt.member_object(req.params.nwid, req.body.id, auth);
        } catch (err) {
          throw err;
        }
      }
    } else if (req.body.activeBridge) {
      req.checkBody('activeBridge', '活动网桥状态必须是布尔值').isBoolean();
      req.sanitize('activeBridge').trim();
      req.sanitize('activeBridge').escape();

      errors = req.validationErrors();

      if (!errors) {
        const activeBridge =
          {
            activeBridge: req.body.activeBridge
          };

        try {
          const mem = await zt.member_object(req.params.nwid, req.body.id, activeBridge);
        } catch (err) {
          throw err;
        }
      }
    } else if (req.body.name) {
      req.sanitize('name').trim();
      req.sanitize('name').escape();

      errors = req.validationErrors();

      if (!errors) {
        try {
          const ret = await storage.setItem(req.body.id, req.body.name);
        } catch (err) {
          throw err;
        }
      }
    }
  } else { // GET
    res.redirect("/controller/network/" + req.params.nwid + "#members");
  }
}

// GET/POST member_delete
exports.member_delete = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
    let member = null;
    let name = null;
    if (req.method === 'POST') {
      member = await zt.member_delete(req.params.nwid, req.params.id);
      if (member.deleted) {
        name = await storage.removeItem(member.id);
      }
    } else {
      member = await zt.member_detail(req.params.nwid, req.params.id);
      name = await storage.getItem(member.id);
    }
    member.name = name || '';

    navigate.whence = '/controller/network/' + network.nwid;
    res.render('member_delete', {title: '从 ' + network.name + ' 删除成员',
                                  navigate: navigate, network: network, member: member});
  } catch (err) {
    res.render('member_delete', {title: '从网络删除成员', navigate: navigate,
                    error: '获取网络 ' + req.params.nwid + ' 的成员 ' + req.params.id
                              + ' 详情时出错：' + err});
  }
}

// GET ipAssignment delete
exports.delete_ip = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    const network = await zt.network_detail(req.params.nwid);
    let member = await zt.member_detail(req.params.nwid, req.params.id);
    navigate.whence = '/controller/network/' + network.nwid;
    member.name = await storage.getItem(member.id) | '';
    if (req.params.index) {
      member = await zt.ipAssignmentDelete(network.nwid, member.id,
                                                              req.params.index);
      res.redirect('/controller/network/' + network.nwid + '/member/' +
                                                  member.id + '/ipAssignments');
    }
    res.render('ipAssignments', {title: 'IP 分配 ' + network.name,
          navigate: navigate, index: req.params.index, network: network, member: member});
  } catch (err) {
    res.render('ipAssignments', {title: 'IP 分配', navigate: navigate,
                    error: '获取网络 ' + req.params.nwid + ' 的成员 ' + req.params.id
                              + ' 详情时出错：' + err});
  }
}

// POST ipAssignments
exports.assign_ip = async function(req, res) {
  const navigate =
    {
      active: 'networks',
      whence: ''
    }

  try {
    var network = await zt.network_detail(req.params.nwid);
  } catch (err) {
    throw err;
  }

  req.checkBody('ipAddress', '请输入 IP 地址').notEmpty();
  req.checkBody('ipAddress', 'IP 地址必须是有效的 IPv4 或 IPv6 地址').isIP();
  req.checkBody('ipAddress', 'IP 地址必须在托管路由范围内')
    .custom(value => {
      let ipAddressInManagedRoute = false;
      network.routes.forEach(function(item) {
        let ipv4 = new ipaddr.Address4(value);
        let target4 = new ipaddr.Address4(item.target);
        if (ipv4.isValid() && target4.isValid()) {
          if (ipv4.isInSubnet(target4)) ipAddressInManagedRoute =  true;
        }
        let ipv6 = new ipaddr.Address6(value);
        let target6 = new ipaddr.Address6(item.target);
        if (ipv6.isValid() && target6.isValid()) {
          if (ipv6.isInSubnet(target6)) ipAddressInManagedRoute =  true;
        }
      });
      return ipAddressInManagedRoute;
    });
  req.sanitize('ipAddress').escape();
  req.sanitize('ipAddress').trim();

  const errors = req.validationErrors();

  const ipAssignment = { ipAddress: req.body.ipAddress };

  try {
    let member = await zt.member_detail(req.params.nwid, req.params.id);
    navigate.whence = '/controller/network/' + network.nwid;

    if (!errors) {
      member = await zt.ipAssignmentAdd(network.nwid, member.id, ipAssignment);
    }

    member.name = await storage.getItem(member.id) | '';

    res.render('ipAssignments', {title: 'IP 分配', navigate: navigate,
                  ipAssignment: ipAssignment, network: network, member: member,
                                                               errors: errors});
  } catch (err) {
    res.render('ipAssignments', {title: 'IP 分配', navigate: navigate,
                    error: '获取网络 ' + req.params.nwid + ' 的成员 ' + req.params.id
                              + ' 详情时出错：' + err});
  }
}