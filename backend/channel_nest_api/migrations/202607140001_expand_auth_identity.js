function timestamps(DataTypes, sequelize) {
  return {
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP'),
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
    },
  };
}

module.exports = {
  async up(queryInterface, DataTypes, { transaction, sequelize }) {
    const users = await queryInterface.describeTable('mm_users');

    await queryInterface.changeColumn('mm_users', 'account', {
      type: DataTypes.STRING(191),
      allowNull: false,
      unique: true,
    }, { transaction });

    if (!users.email) {
      await queryInterface.addColumn('mm_users', 'email', {
        type: DataTypes.STRING(191),
        allowNull: true,
      }, { transaction });
      await queryInterface.addIndex('mm_users', ['email'], {
        name: 'uk_mm_users_email',
        unique: true,
        transaction,
      });
    }
    if (!users.email_verified_at) {
      await queryInterface.addColumn('mm_users', 'email_verified_at', {
        type: DataTypes.DATE,
        allowNull: true,
      }, { transaction });
    }

    await queryInterface.createTable('mm_email_verification_codes', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      email: { type: DataTypes.STRING(191), allowNull: false },
      scene: { type: DataTypes.STRING(32), allowNull: false },
      code_hash: { type: DataTypes.CHAR(64), allowNull: false },
      attempt_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      request_ip_hash: { type: DataTypes.CHAR(64), allowNull: false },
      last_attempt_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      consumed_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps(DataTypes, sequelize),
    }, { transaction });
    await queryInterface.addIndex('mm_email_verification_codes', ['email', 'scene', 'created_at'], {
      name: 'idx_mm_email_codes_email_scene_created', transaction,
    });
    await queryInterface.addIndex('mm_email_verification_codes', ['request_ip_hash', 'created_at'], {
      name: 'idx_mm_email_codes_ip_created', transaction,
    });
    await queryInterface.addIndex('mm_email_verification_codes', ['expires_at', 'consumed_at'], {
      name: 'idx_mm_email_codes_expires_consumed', transaction,
    });

    await queryInterface.createTable('mm_auth_sessions', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: {
        type: DataTypes.CHAR(36),
        allowNull: false,
        references: { model: 'mm_users', key: 'id' },
        onDelete: 'RESTRICT',
      },
      token_hash: { type: DataTypes.CHAR(64), allowNull: false },
      login_ip_hash: { type: DataTypes.CHAR(64), allowNull: true },
      user_agent_hash: { type: DataTypes.CHAR(64), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
      ...timestamps(DataTypes, sequelize),
    }, { transaction });
    await queryInterface.addIndex('mm_auth_sessions', ['token_hash'], {
      name: 'uk_mm_auth_sessions_token_hash', unique: true, transaction,
    });
    await queryInterface.addIndex('mm_auth_sessions', ['user_id', 'revoked_at', 'expires_at'], {
      name: 'idx_mm_auth_sessions_user_state', transaction,
    });
    await queryInterface.addIndex('mm_auth_sessions', ['expires_at'], {
      name: 'idx_mm_auth_sessions_expires', transaction,
    });
  },
};
