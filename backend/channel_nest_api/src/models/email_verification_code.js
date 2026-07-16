const { DataTypes } = require('sequelize');
const sequelize = require('../libs/sequelizor');

const EmailVerificationCode = sequelize.define('EmailVerificationCode', {
  id: { type: DataTypes.CHAR(36), primaryKey: true },
  email: { type: DataTypes.STRING(191), allowNull: false },
  scene: { type: DataTypes.STRING(32), allowNull: false },
  code_hash: { type: DataTypes.CHAR(64), allowNull: false },
  attempt_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  request_ip_hash: { type: DataTypes.CHAR(64), allowNull: false },
  last_attempt_at: DataTypes.DATE,
  expires_at: { type: DataTypes.DATE, allowNull: false },
  consumed_at: DataTypes.DATE,
}, {
  tableName: 'mm_email_verification_codes',
  underscored: true,
});

module.exports = EmailVerificationCode;
