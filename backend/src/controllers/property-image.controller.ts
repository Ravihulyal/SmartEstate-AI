import { Response } from "express";
import { z } from "zod";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  CloudinaryConfigurationError,
  deleteOwnedCloudinaryImage,
  InvalidImageContentError,
  uploadPropertyImages
} from "../services/cloudinary.service";

const deleteImageSchema = z.object({
  secureUrl: z.string().url()
}).strict();

export async function uploadPropertyImageFiles(
  req: AuthRequest,
  res: Response
) {
  const files = req.files;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      message: "Select at least one image to upload"
    });
  }

  try {
    const images = await uploadPropertyImages(req.user!.id, files);
    return res.status(201).json({
      images: images.map((secureUrl) => ({ secureUrl }))
    });
  } catch (error) {
    if (error instanceof CloudinaryConfigurationError) {
      return res.status(503).json({
        message: "Image uploads are not configured on the server"
      });
    }

    if (error instanceof InvalidImageContentError) {
      return res.status(415).json({
        message: "The uploaded file content is not a valid supported image"
      });
    }

    return res.status(502).json({
      message: "Image upload failed. Please try again."
    });
  }
}

export async function deletePropertyImage(
  req: AuthRequest,
  res: Response
) {
  const parsed = deleteImageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "A valid Cloudinary secureUrl is required"
    });
  }

  try {
    await deleteOwnedCloudinaryImage(parsed.data.secureUrl, req.user!.id);
    return res.status(200).json({
      success: true,
      message: "Image removed"
    });
  } catch (error) {
    if (error instanceof CloudinaryConfigurationError) {
      return res.status(503).json({
        message: "Image uploads are not configured on the server"
      });
    }

    if (error instanceof InvalidImageContentError) {
      return res.status(403).json({
        message: "You can only remove images uploaded to your seller account"
      });
    }

    return res.status(502).json({
      message: "Image removal failed. Please try again."
    });
  }
}
