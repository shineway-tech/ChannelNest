const { DataTypes } = require('sequelize');
const sequelize = require('../libs/sequelizor');

const AuthSession = sequelize.define('AuthSession', {
  id: { type: DataTypes.CHAR(36), primaryKey: true },
  user_id: { type: DataTypes.CHAR(36), allowNull: false },
  token_hash: { type: DataTypes.CHAR(64), allowNull: false },
  login_ip_hash: DataTypes.CHAR(64),
  user_agent_hash: DataTypes.CHAR(64),
  expires_at: { type: DataTypes.DATE, allowNull: false },
  revoked_at: DataTypes.DATE,
  last_seen_at: DataTypes.DATE,
}, {
  tableName: 'mm_auth_sessions',
  underscored: true,
});

module.exports = AuthSession;
