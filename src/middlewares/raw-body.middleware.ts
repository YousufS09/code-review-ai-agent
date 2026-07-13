import express from "express";

export const jsonWithRawBody = express.json({
  limit: "2mb",
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  }
});
