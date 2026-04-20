import Joi from "joi";

const contentBlockValidator = Joi.object({
  blockId: Joi.string().optional(),
  type: Joi.string()
    .valid("heading", "paragraph", "image", "list", "quote")
    .required(),
  text: Joi.string().allow("").optional(),
  level: Joi.number().min(1).max(6).optional(),
  listItems: Joi.array().items(Joi.string().trim()).optional(),
  image: Joi.string().allow("").optional(),
  imageFileIndex: Joi.number().integer().min(0).optional(),
  order: Joi.number().optional(),
});

export const createBlogValidator = Joi.object({
  title: Joi.string().trim().max(200).required(),
  slug: Joi.string().trim().allow("").optional(),
  shortDescription: Joi.string().trim().max(500).required(),
  content: Joi.array().items(contentBlockValidator).min(1).required(),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  status: Joi.string().valid("draft", "published", "archived").optional(),
  featured: Joi.boolean().optional(),
  permission: Joi.string().trim().required(),
});

export const updateBlogValidator = Joi.object({
  title: Joi.string().trim().max(200).optional(),
  slug: Joi.string().trim().allow("").optional(),
  shortDescription: Joi.string().trim().max(500).optional(),
  content: Joi.array().items(contentBlockValidator).optional(),
  tags: Joi.array().items(Joi.string().trim()).optional(),
  status: Joi.string().valid("draft", "published", "archived").optional(),
  featured: Joi.boolean().optional(),
  removeBannerImage: Joi.boolean().optional(),
  permission: Joi.string().trim().required(),
});


/* ---------- ADD BLOG COMMENT VALIDATOR ---------- */
export const addBlogCommentValidator = Joi.object({
  name: Joi.string().trim().max(100).required(),

  company: Joi.string().trim().max(150).allow("").optional(),

  city: Joi.string().trim().max(100).allow("").optional(),

  review: Joi.string().trim().max(2000).required(),
});