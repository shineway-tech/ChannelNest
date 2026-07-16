const { validateBody } = require('@honeykid/ml');
const Joi = require('joi');

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } })
  .max(191)
  .required()
  .label('邮箱');

const password = Joi.string().min(6).max(64)
  .required()
  .label('密码');

const captcha = {
  captcha_id: Joi.string().guid({ version: 'uuidv4' }).required()
    .label('验证码 ID'),
  captcha_code: Joi.string().trim().min(4).max(8)
    .required()
    .label('验证码'),
};

const checkRegister = validateBody(Joi.object({
  email,
  password,
  nickname: Joi.string().trim().empty('')
    .max(32)
    .label('昵称'),
  email_code_id: Joi.string().guid({ version: 'uuidv4' }).required(),
  email_code: Joi.string().pattern(/^\d{6}$/).required(),
}), { stripUnknown: true });

const checkLogin = validateBody(Joi.object({
  identifier: Joi.string().trim().lowercase().min(3)
    .max(191)
    .required()
    .label('邮箱或账号'),
  password,
}), { stripUnknown: true });

const checkEmailCode = validateBody(Joi.object({
  email,
  scene: Joi.string().valid('register', 'bind_email', 'reset_password').required(),
  ...captcha,
}), { stripUnknown: true });

const checkBindEmail = validateBody(Joi.object({
  email,
  current_password: password.label('当前密码'),
  email_code_id: Joi.string().guid({ version: 'uuidv4' }).required(),
  email_code: Joi.string().pattern(/^\d{6}$/).required(),
}), { stripUnknown: true });

const checkResetPassword = validateBody(Joi.object({
  email,
  new_password: password.label('新密码'),
  email_code_id: Joi.string().guid({ version: 'uuidv4' }).required(),
  email_code: Joi.string().pattern(/^\d{6}$/).required(),
}), { stripUnknown: true });

const checkUpdateProfile = validateBody(Joi.object({
  nickname: Joi.string().trim().min(1).max(32)
    .required()
    .label('昵称'),
}), { stripUnknown: true });

const checkUpdatePassword = validateBody(Joi.object({
  current_password: password.label('当前密码'),
  new_password: password.label('新密码'),
}), { stripUnknown: true });

module.exports = {
  checkLogin,
  checkEmailCode,
  checkBindEmail,
  checkResetPassword,
  checkRegister,
  checkUpdatePassword,
  checkUpdateProfile,
};
