require('dotenv').config();
const { v2: cloudinary } = require('cloudinary');

function env(name) {
  const value = process.env[name];
  if (value == null) return '';
  return String(value).trim().replace(/^["']|["']$/g, '');
}

function isCloudinaryConfigured() {
  return Boolean(
    env('CLOUDINARY_CLOUD_NAME') &&
      env('CLOUDINARY_API_KEY') &&
      env('CLOUDINARY_API_SECRET')
  );
}

function configureCloudinary() {
  if (!isCloudinaryConfigured()) return false;

  cloudinary.config({
    cloud_name: env('CLOUDINARY_CLOUD_NAME'),
    api_key: env('CLOUDINARY_API_KEY'),
    api_secret: env('CLOUDINARY_API_SECRET'),
    secure: true,
  });

  return true;
}

function uploadBufferToCloudinary(buffer, options = {}) {
  if (!configureCloudinary()) {
    const err = new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
    err.code = 'CLOUDINARY_NOT_CONFIGURED';
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'worknest/avatars',
        resource_type: 'image',
        overwrite: true,
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

async function destroyCloudinaryImage(publicId) {
  if (!publicId || !configureCloudinary()) return null;
  return cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

module.exports = {
  cloudinary,
  isCloudinaryConfigured,
  configureCloudinary,
  uploadBufferToCloudinary,
  destroyCloudinaryImage,
};
