const { ApiBaseError } = require('@honeykid/ml/errors');

class BusinessError extends ApiBaseError {
  constructor(statusCode, errorCode, message, details = null) {
    super(statusCode, errorCode, message);
    this.details = details;
  }
}

module.exports = BusinessError;
