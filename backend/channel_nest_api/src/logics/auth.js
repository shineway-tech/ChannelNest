const crypto = require('crypto');
const { Op, literal } = require('sequelize');
const { logger } = require('@honeykid/ml');
const {
  BadArgumentError,
  ForbiddenError,
  NotFoundError,
} = require('@honeykid/ml/errors');
const sequelize = require('../libs/sequelizor');
const AuthCaptcha = require('../models/auth_captcha');
const AuthSession = require('../models/auth_session');
const AuthUser = require('../models/auth_user');
const EmailVerificationCode = require('../models/email_verification_code');
const EmailService = require('../services/email');
const BusinessError = require('../utils/business_error');
const ErrorCodes = require('../utils/error_codes');
const Jwt = require('../utils/jwt');
const {
  hashPassword,
  hmac,
  privateHash,
  sha256,
  verifyPassword,
} = require('../utils/security');
const { JwtTokenTTL } = require('../utils/constants');
const config = require('../../config');

const CaptchaChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EmailVerification = config.email.verification;
const EmailCodeTTL = EmailVerification.ttl_seconds * 1000;
const Hour = 60 * 60 * 1000;
const Day = 24 * Hour;

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function toClientUser(user) {
  const emailVerified = Boolean(user.email && user.email_verified_at);

  return {
    id: user.id,
    account: user.account,
    email: user.email || null,
    emailVerified,
    needsEmailBinding: !emailVerified,
    nickname: user.nickname,
    status: user.status,
    lastLoginAt: user.last_login_at,
  };
}

function randomCaptchaCode() {
  return Array.from({ length: 4 }, () => (
    CaptchaChars[crypto.randomInt(0, CaptchaChars.length)]
  )).join('');
}

function captchaSvg(code) {
  const text = code.split('').map((char, index) => {
    const x = 22 + index * 24;
    const y = 38 + (index % 2 === 0 ? 0 : -4);
    const rotate = [-9, 5, -4, 8][index] || 0;

    return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="132" height="48" viewBox="0 0 132 48">
    <rect width="132" height="48" rx="8" fill="#10272d"/>
    <path d="M8 36 C34 8, 58 52, 124 14" stroke="#16e68a" stroke-opacity=".34" stroke-width="2" fill="none"/>
    <g fill="#d8e5e7" font-family="Menlo, Consolas, monospace" font-size="25" font-weight="800">${text}</g>
  </svg>`;
}

function codeHash(id, email, scene, code) {
  return hmac(`${id}|${email}|${scene}|${code}`, config.email.code_hmac_pepper);
}

function durationText(seconds) {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`;
  return `${Math.ceil(seconds / 3600)} 小时`;
}

function recordsWithin(records, windowMs, now) {
  const since = now.getTime() - windowMs;
  return records.filter((record) => new Date(record.created_at).getTime() > since);
}

function retryAfter(records, windowMs, now) {
  const oldest = new Date(records[0].created_at).getTime();
  return Math.max(1, Math.ceil((oldest + windowMs - now.getTime()) / 1000));
}

class AuthLogic {
  static async captcha() {
    const code = randomCaptchaCode();
    const item = plain(await AuthCaptcha.create({
      id: crypto.randomUUID(),
      code,
      scene: 'auth',
      expires_at: new Date(Date.now() + EmailCodeTTL),
    }));

    return {
      captchaId: item.id,
      image: `data:image/svg+xml;base64,${Buffer.from(captchaSvg(code)).toString('base64')}`,
      expiresAt: item.expires_at,
    };
  }

  static async sendEmailCode(entries, requestMeta, authUser) {
    await AuthLogic.verifyCaptcha(entries.captcha_id, entries.captcha_code);

    const email = normalizeEmail(entries.email);
    const { scene } = entries;
    if (scene === 'bind_email' && (!authUser || authUser.source === 'desktop')) {
      throw new BusinessError(401, ErrorCodes.REGISTERED_LOGIN_REQUIRED, '请先登录后绑定邮箱');
    }

    const ipHash = privateHash(requestMeta.ip || 'unknown');
    if (scene === 'register' && await AuthLogic.findUserByEmail(email)) {
      throw new BadArgumentError('该邮箱已注册');
    }
    if (scene === 'bind_email') {
      const current = await AuthLogic.findUserById(authUser.id);
      if (current.email_verified_at) {
        throw new BadArgumentError('当前账号已绑定邮箱');
      }
      if (await AuthLogic.findUserByEmail(email)) {
        throw new BadArgumentError('该邮箱已被其他账号使用');
      }
    }
    await AuthLogic.enforceEmailCodeRateLimit(email, ipHash);

    const id = crypto.randomUUID();
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const record = await EmailVerificationCode.create({
      id,
      email,
      scene,
      code_hash: codeHash(id, email, scene, code),
      request_ip_hash: ipHash,
      expires_at: new Date(Date.now() + EmailCodeTTL),
    });

    try {
      await EmailService.sendVerificationCode(email, scene, code);
    } catch (error) {
      await record.destroy();
      throw error;
    }

    try {
      await EmailVerificationCode.update({ consumed_at: new Date() }, {
        where: {
          id: { [Op.ne]: id }, email, scene, consumed_at: null,
        },
      });
    } catch (error) {
      logger.error(`Failed to invalidate previous email codes: ${error.message}`);
    }

    return {
      codeId: id,
      expiresIn: EmailCodeTTL / 1000,
      retryAfter: EmailVerification.resend_seconds,
    };
  }

  static async enforceEmailCodeRateLimit(email, ipHash) {
    const now = new Date();
    const since = new Date(now.getTime() - Day);
    const [emailRecords, ipRecords] = await Promise.all([
      EmailVerificationCode.findAll({
        attributes: ['created_at'],
        where: { email, created_at: { [Op.gt]: since } },
        order: [['created_at', 'ASC']],
        limit: EmailVerification.email_daily_limit,
        raw: true,
      }),
      EmailVerificationCode.findAll({
        attributes: ['created_at'],
        where: { request_ip_hash: ipHash, created_at: { [Op.gt]: since } },
        order: [['created_at', 'ASC']],
        limit: EmailVerification.ip_daily_limit,
        raw: true,
      }),
    ]);

    AuthLogic.assertEmailCodeLimit(
      recordsWithin(emailRecords, EmailVerification.resend_seconds * 1000, now),
      1,
      EmailVerification.resend_seconds * 1000,
      now,
      '发送过于频繁',
    );
    AuthLogic.assertEmailCodeLimit(
      recordsWithin(emailRecords, Hour, now),
      EmailVerification.email_hourly_limit,
      Hour,
      now,
      '该邮箱验证码发送次数已达上限',
    );
    AuthLogic.assertEmailCodeLimit(
      emailRecords,
      EmailVerification.email_daily_limit,
      Day,
      now,
      '该邮箱验证码发送次数已达上限',
    );
    AuthLogic.assertEmailCodeLimit(
      recordsWithin(ipRecords, Hour, now),
      EmailVerification.ip_hourly_limit,
      Hour,
      now,
      '当前网络请求验证码次数较多',
    );
    AuthLogic.assertEmailCodeLimit(
      ipRecords,
      EmailVerification.ip_daily_limit,
      Day,
      now,
      '当前网络请求验证码次数较多',
    );
  }

  static assertEmailCodeLimit(records, limit, windowMs, now, message) {
    if (records.length < limit) return;
    const seconds = retryAfter(records, windowMs, now);
    throw new BusinessError(
      429,
      ErrorCodes.EMAIL_CODE_RATE_LIMITED,
      `${message}，请 ${durationText(seconds)}后重试。`,
      { retryAfter: seconds },
    );
  }

  static async register(entries, requestMeta) {
    const email = normalizeEmail(entries.email);

    return AuthLogic.withEmailCodeTransaction(async (transaction) => {
      if (await AuthLogic.findUserByEmail(email, transaction)) {
        throw new BadArgumentError('该邮箱已注册');
      }
      await AuthLogic.consumeEmailCode({
        id: entries.email_code_id,
        email,
        scene: 'register',
        code: entries.email_code,
      }, transaction);

      const user = plain(await AuthUser.create({
        id: crypto.randomUUID(),
        account: email,
        email,
        email_verified_at: new Date(),
        nickname: entries.nickname || email.split('@')[0],
        password_hash: hashPassword(entries.password),
        status: 'active',
      }, { transaction }));

      // Wallet module is loaded lazily to keep authentication reusable during migrations.
      const PointWallet = require('./point_wallet');
      await PointWallet.grantSignupGift(user.id, transaction);
      const MessageLogic = require('./message');
      await MessageLogic.create({
        userId: user.id,
        category: 'points',
        level: 'success',
        templateCode: 'signup_gift',
        dedupeKey: `signup:${user.id}:gift`,
      }, transaction);

      return AuthLogic.issueSession(user, requestMeta, transaction);
    });
  }

  static async login(entries, requestMeta) {
    const identifier = String(entries.identifier || entries.account || '').trim().toLowerCase();
    const user = identifier.includes('@')
      ? await AuthLogic.findUserByEmail(identifier)
      : await AuthLogic.findUserByAccount(identifier);

    if (!user || !verifyPassword(entries.password, user.password_hash)) {
      throw new BadArgumentError('账号或密码错误');
    }
    if (user.status !== 'active') {
      throw new ForbiddenError('账号不可用');
    }

    const lastLoginAt = new Date();
    await AuthUser.update({ last_login_at: lastLoginAt }, { where: { id: user.id } });

    return AuthLogic.issueSession({ ...user, last_login_at: lastLoginAt }, requestMeta);
  }

  static async logout(authUser) {
    if (authUser && authUser.sessionId) {
      await AuthSession.update({ revoked_at: new Date() }, {
        where: { id: authUser.sessionId, user_id: authUser.id, revoked_at: null },
      });
    }

    return { loggedOut: true };
  }

  static async bindEmail(userId, entries) {
    const email = normalizeEmail(entries.email);

    return AuthLogic.withEmailCodeTransaction(async (transaction) => {
      const user = plain(await AuthUser.findOne({
        where: { id: userId }, transaction, lock: transaction.LOCK.UPDATE,
      }));
      if (!user) throw new NotFoundError('用户不存在');
      if (user.email_verified_at) throw new BadArgumentError('当前账号已绑定邮箱');
      if (!verifyPassword(entries.current_password, user.password_hash)) {
        throw new BadArgumentError('当前密码错误');
      }
      if (await AuthLogic.findUserByEmail(email, transaction)) {
        throw new BadArgumentError('该邮箱已被其他账号使用');
      }

      await AuthLogic.consumeEmailCode({
        id: entries.email_code_id,
        email,
        scene: 'bind_email',
        code: entries.email_code,
      }, transaction);
      await AuthUser.update({ email, email_verified_at: new Date() }, {
        where: { id: userId }, transaction,
      });

      const PointWallet = require('./point_wallet');
      await PointWallet.grantSignupGift(userId, transaction);
      const MessageLogic = require('./message');
      await MessageLogic.create({
        userId,
        category: 'points',
        level: 'success',
        templateCode: 'signup_gift',
        dedupeKey: `signup:${userId}:gift`,
      }, transaction);

      return toClientUser({ ...user, email, email_verified_at: new Date() });
    });
  }

  static async resetPassword(entries) {
    const email = normalizeEmail(entries.email);

    await AuthLogic.withEmailCodeTransaction(async (transaction) => {
      const user = plain(await AuthUser.findOne({
        where: { email }, transaction, lock: transaction.LOCK.UPDATE,
      }));
      if (!user) throw new BadArgumentError('验证码错误或已失效');

      await AuthLogic.consumeEmailCode({
        id: entries.email_code_id,
        email,
        scene: 'reset_password',
        code: entries.email_code,
      }, transaction);
      await AuthUser.update({ password_hash: hashPassword(entries.new_password) }, {
        where: { id: user.id }, transaction,
      });
      await AuthSession.update({ revoked_at: new Date() }, {
        where: { user_id: user.id, revoked_at: null }, transaction,
      });
    });

    return { reset: true };
  }

  static async me(userId) {
    const user = await AuthLogic.findUserById(userId);
    if (!user) throw new NotFoundError('用户不存在');

    return toClientUser(user);
  }

  static async updateProfile(userId, entries) {
    const [count] = await AuthUser.update(
      { nickname: entries.nickname },
      { where: { id: userId } },
    );
    if (!count) throw new NotFoundError('用户不存在');

    return toClientUser(await AuthLogic.findUserById(userId));
  }

  static async updatePassword(userId, entries) {
    const user = await AuthLogic.findUserById(userId);
    if (!user) throw new NotFoundError('用户不存在');
    if (!verifyPassword(entries.current_password, user.password_hash)) {
      throw new BadArgumentError('当前密码错误');
    }
    if (verifyPassword(entries.new_password, user.password_hash)) {
      throw new BadArgumentError('新密码不能与当前密码相同');
    }

    await AuthUser.update({ password_hash: hashPassword(entries.new_password) }, {
      where: { id: userId },
    });

    return toClientUser(await AuthLogic.findUserById(userId));
  }

  static async verifyCaptcha(captchaId, code) {
    const result = await sequelize.transaction(async (transaction) => {
      const captcha = plain(await AuthCaptcha.findOne({
        where: { id: captchaId, used_at: null, expires_at: { [Op.gt]: new Date() } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      }));
      if (!captcha) return 'expired';

      await AuthCaptcha.update({ used_at: new Date() }, { where: { id: captchaId }, transaction });
      return String(captcha.code).toLowerCase() === String(code).trim().toLowerCase()
        ? 'valid'
        : 'invalid';
    });

    if (result === 'expired') throw new BadArgumentError('图形验证码已失效');
    if (result === 'invalid') throw new BadArgumentError('图形验证码错误');
  }

  static async consumeEmailCode(input, transaction) {
    const row = plain(await EmailVerificationCode.findOne({
      where: {
        id: input.id,
        email: input.email,
        scene: input.scene,
        consumed_at: null,
        expires_at: { [Op.gt]: new Date() },
        attempt_count: { [Op.lt]: EmailVerification.max_attempts },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    }));
    if (!row) {
      throw new BusinessError(400, ErrorCodes.EMAIL_CODE_INVALID, '验证码错误或已失效');
    }

    const expected = codeHash(row.id, row.email, row.scene, input.code);
    if (expected !== row.code_hash) {
      throw new BusinessError(
        400,
        ErrorCodes.EMAIL_CODE_INVALID,
        '验证码错误或已失效',
        { emailCodeId: row.id },
      );
    }

    await EmailVerificationCode.update({ consumed_at: new Date(), last_attempt_at: new Date() }, {
      where: { id: row.id }, transaction,
    });
  }

  static async withEmailCodeTransaction(callback) {
    try {
      return await sequelize.transaction(callback);
    } catch (error) {
      const emailCodeId = error instanceof BusinessError && error.details
        ? error.details.emailCodeId
        : null;
      if (error.errorCode === ErrorCodes.EMAIL_CODE_INVALID && emailCodeId) {
        await EmailVerificationCode.update({
          attempt_count: literal('attempt_count + 1'),
          last_attempt_at: new Date(),
        }, {
          where: {
            id: emailCodeId,
            attempt_count: { [Op.lt]: EmailVerification.max_attempts },
          },
        });
      }
      throw error;
    }
  }

  static async issueSession(user, requestMeta, transaction = null) {
    const sessionId = crypto.randomUUID();
    const token = Jwt.generateToken(user.id, sessionId, JwtTokenTTL);
    await AuthSession.create({
      id: sessionId,
      user_id: user.id,
      token_hash: sha256(token),
      login_ip_hash: requestMeta.ip ? privateHash(requestMeta.ip) : null,
      user_agent_hash: requestMeta.userAgent ? sha256(requestMeta.userAgent) : null,
      expires_at: new Date(Date.now() + JwtTokenTTL * 1000),
      last_seen_at: new Date(),
    }, { transaction });

    return {
      token,
      tokenName: Jwt.getTokenName(),
      expiresIn: JwtTokenTTL,
      user: toClientUser(user),
    };
  }

  static async findUserByAccount(account, transaction = null) {
    return AuthUser.findOne({ where: { account }, transaction }).then(plain);
  }

  static async findUserByEmail(email, transaction = null) {
    return AuthUser.findOne({ where: { email: normalizeEmail(email) }, transaction }).then(plain);
  }

  static async findUserById(id) {
    return AuthUser.findOne({ where: { id } }).then(plain);
  }
}

module.exports = AuthLogic;
