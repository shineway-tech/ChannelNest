module.exports = {
  ...require('./domain'),
  AuthCaptcha: require('./auth_captcha'),
  AuthSession: require('./auth_session'),
  AuthUser: require('./auth_user'),
  EmailVerificationCode: require('./email_verification_code'),
  Feedback: require('./feedback'),
};
