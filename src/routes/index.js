/*
  ztncui - ZeroTier network controller UI
  Copyright (C) 2017-2021  Key Networks (https://key-networks.com)
  Licensed under GPLv3 - see LICENSE for details.
*/

const express = require('express');
const auth = require('../controllers/auth');
const authenticate = auth.authenticate;
const restrict = auth.restrict;
const router = express.Router();
const fs = require('fs');  // 用于文件操作
const path = require('path');  // 用于路径处理

/** Redirect logged user to controler page */
function guest_only(req, res, next) {
  if (req.session.user) {
    res.redirect('/controller');
  } else {
    next();
  }
}

/* GET home page. */
router.get('/', guest_only, function(req, res, next) {
  res.render('front_door', {title: 'ztncui'});
});

router.get('/logout', function(req, res) {
  req.session.destroy(function() {
    res.redirect('/');
  });
});

router.get('/login', guest_only, function(req, res) {
  let message = null;
  if (req.session.error) {
    if (req.session.error !== 'Access denied!') {
      message = req.session.error;
    }
  } else {
    message = req.session.success;
  }
  res.render('login', { title: 'Login', message: message });
});

router.post('/login', async function(req, res) {
  await authenticate(req.body.username, req.body.password, function(err, user) {
    if (user) {
      req.session.regenerate(function() {
        req.session.user = user;
        req.session.success = 'Authenticated as ' + user.name;
        if (user.pass_set) {
          res.redirect(req.query.redirect || '/controller');
        } else {
          res.redirect('/users/' + user.name + '/password');
        }
      });
    } else {
      req.session.error = 'Authentication failed, please check your username and password.'
      res.redirect('/login');
    }
  });
});

// ========== 文件下载路由（需要登录） ==========

/**
 * 下载 planet 文件
 * 文件路径：/app/dist/planet
 * 需要用户已登录
 */
router.get('/download/planet', restrict, function(req, res) {
  const filePath = '/app/dist/planet';
  
  // 检查文件是否存在
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).send('planet 文件不存在');
    }
    
    res.download(filePath, 'planet', (err) => {
      if (err) {
        console.error('下载 planet 文件失败:', err);
        res.status(500).send('文件下载失败');
      }
    });
  });
});

/**
 * 下载 .moon 文件
 * 文件路径：/app/dist/*.moon
 * 自动查找目录下的第一个 .moon 文件
 * 需要用户已登录
 */
router.get('/download/moon', restrict, function(req, res) {
  const distPath = '/app/dist';
  
  // 检查目录是否存在
  fs.access(distPath, fs.constants.F_OK, (err) => {
    if (err) {
      return res.status(404).send('目录不存在');
    }
    
    fs.readdir(distPath, (err, files) => {
      if (err) {
        console.error('读取目录失败:', err);
        return res.status(500).send('读取目录失败');
      }
      
      // 查找第一个 .moon 文件
      const moonFile = files.find(f => f.endsWith('.moon'));
      if (!moonFile) {
        return res.status(404).send('未找到 .moon 文件');
      }
      
      const filePath = path.join(distPath, moonFile);
      res.download(filePath, moonFile, (err) => {
        if (err) {
          console.error('下载 .moon 文件失败:', err);
          res.status(500).send('文件下载失败');
        }
      });
    });
  });
});

module.exports = router;
