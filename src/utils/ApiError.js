class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message, details) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Authentification requise') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Accès refusé') {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'Ressource introuvable') {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message) {
    return new ApiError(409, 'CONFLICT', message);
  }
}

module.exports = ApiError;
