import multer from "multer";
import type { RequestHandler } from "express";

export const MAX_PROPERTY_IMAGES = 6;
export const MAX_PROPERTY_IMAGE_BYTES = 5 * 1024 * 1024;
const acceptedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

class UnsupportedImageTypeError extends Error {}

const parseImages = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PROPERTY_IMAGE_BYTES,
    files: MAX_PROPERTY_IMAGES,
    fields: 0,
    parts: MAX_PROPERTY_IMAGES
  },
  fileFilter: (_req, file, callback) => {
    if (!acceptedMimeTypes.has(file.mimetype)) {
      callback(new UnsupportedImageTypeError());
      return;
    }

    callback(null, true);
  }
}).array("images", MAX_PROPERTY_IMAGES);

export const parsePropertyImageUpload: RequestHandler = (req, res, next) => {
  parseImages(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof UnsupportedImageTypeError) {
      res.status(415).json({
        message: "Only JPEG, PNG, and WebP images are allowed"
      });
      return;
    }

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        message: "Each image must be 5 MB or smaller"
      });
      return;
    }

    if (
      error instanceof multer.MulterError &&
      (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE" || error.code === "LIMIT_PART_COUNT")
    ) {
      res.status(413).json({
        message: `Upload no more than ${MAX_PROPERTY_IMAGES} images at a time`
      });
      return;
    }

    console.error("Property image multipart parsing failed");
    res.status(400).json({
      message: "Invalid image upload request"
    });
  });
};
