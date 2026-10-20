// The environment's photo ownership policy (ADR 0011, EMR-75). The core
// receives the folder as a value; it never reads configuration itself.
import { DEV_PHOTOS_PREFIX, PHOTOS_PREFIX, type PhotoFolder } from "../core/photos/photo.ts";

export function mediaPhotoFolder(vars: { ENVIRONMENT?: string | undefined }): PhotoFolder {
  return vars.ENVIRONMENT === "dev" ? DEV_PHOTOS_PREFIX : PHOTOS_PREFIX;
}
