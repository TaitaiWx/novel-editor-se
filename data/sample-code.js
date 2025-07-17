/**
 * 示例 JavaScript 文件
 * 用于测试代码解析器功能
 */

import { ParserFactory } from '../src/render/parsers';

/**
 * 用户类
 * 表示系统中的用户实体
 */
class User {
  constructor(name, email) {
    this.name = name;
    this.email = email;
    this.createdAt = new Date();
  }

  /**
   * 获取用户信息
   * @returns {Object} 用户信息对象
   */
  getInfo() {
    return {
      name: this.name,
      email: this.email,
      createdAt: this.createdAt
    };
  }

  /**
   * 更新用户信息
   * @param {Object} updates 更新数据
   */
  updateInfo(updates) {
    Object.assign(this, updates);
  }
}

/**
 * 用户管理器类
 * 负责用户数据的增删改查
 */
class UserManager {
  constructor() {
    this.users = new Map();
  }

  /**
   * 添加新用户
   * @param {string} name 用户名
   * @param {string} email 邮箱
   * @returns {User} 新创建的用户对象
   */
  addUser(name, email) {
    const user = new User(name, email);
    this.users.set(user.email, user);
    return user;
  }

  /**
   * 根据邮箱查找用户
   * @param {string} email 邮箱地址
   * @returns {User|null} 用户对象或null
   */
  findUserByEmail(email) {
    return this.users.get(email) || null;
  }

  /**
   * 删除用户
   * @param {string} email 邮箱地址
   * @returns {boolean} 是否删除成功
   */
  deleteUser(email) {
    return this.users.delete(email);
  }

  /**
   * 获取所有用户列表
   * @returns {Array} 用户数组
   */
  getAllUsers() {
    return Array.from(this.users.values());
  }
}

// 工具函数
/**
 * 验证邮箱格式
 * @param {string} email 邮箱地址
 * @returns {boolean} 是否有效
 */
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 格式化日期
 * @param {Date} date 日期对象
 * @returns {string} 格式化后的日期字符串
 */
function formatDate(date) {
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// 导出模块
export { User, UserManager, validateEmail, formatDate }; 