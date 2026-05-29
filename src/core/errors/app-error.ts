type AppErrorOptions = {
  code?: string;
  details?: Record<string, unknown>;
};

export class AppError extends Error {
  public statusCode: number;
  public success: boolean;
  public code?: string;
  public details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    options: AppErrorOptions = {}
  ) {
    super(message);

    this.statusCode = statusCode;
    this.success = false;
    this.code = options.code;
    this.details = options.details;

    Error.captureStackTrace(this, this.constructor);
  }
}
