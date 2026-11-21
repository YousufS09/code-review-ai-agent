import type { ErrorRequestHandler, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/http-error.util";

export function notFoundMiddleware(_request: Request, response: Response): void {
  response.status(404).json({
    error: "Not Found"
  });
}

export const errorMiddleware: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
    return;
  }

  if (error instanceof HttpError && error.expose) {
    response.status(error.statusCode).json({
      error: error.message
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: "Internal Server Error"
  });
};

