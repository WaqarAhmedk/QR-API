const httpStatus = require("http-status");
const APIError = require("../errors/api-error");
const { uploadFile, deleteFile } = require("../../storage/gcs");
const Resource = require("../models/resource.model");

exports.fileSave = async (req, res, next) => {
  try {
    const files = req.files; // Array of files
    const uploadPromises = [];
    for (const file of files) {
      uploadPromises.push(uploadFile(file));
    }

    const uploadResults = await Promise.all(uploadPromises);

    const savedResources = uploadResults.map((result, index) => {
      const { identifier, url, gcsName } = result;

      const resource = new Resource({
        name: files[index].originalname,
        gcsName,
        url,
        public: true,
        identifier,
      });

      return resource.save();
    });

    const savedResourcesData = await Promise.all(savedResources);

    res.json(savedResourcesData);
  } catch (error) {
    next(error);
  }
};

exports.fileDelete = async (req, res, next) => {
  try {
    const { url } = req.body;

    const resource = await Resource.findOne({ url });
    const response = await deleteFile(resource.gcsName);
    res.json(response);
  } catch (error) {
    next(error);
  }
};
