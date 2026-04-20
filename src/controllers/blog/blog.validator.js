import Joi from "joi";

/* ---------- CONTENT BLOCK VALIDATOR ---------- */
const contentBlockValidator = Joi.object({
  type: Joi.string()
    .valid("heading", "paragraph", "image", "list", "quote")
    .required(),

  text: Joi.string().trim().allow("").optional(),

  level: Joi.number().integer().min(1).max(6).optional(),

  listItems: Joi.array().items(Joi.string().trim()).optional(),

  image: Joi.string().trim().allow("").optional(),

  imageFileIndex: Joi.number().integer().min(0).optional(),

  order: Joi.number().integer().min(0).optional(),
});

/* ---------- CREATE BLOG VALIDATOR ---------- */
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

/* ---------- UPDATE BLOG VALIDATOR ---------- */
export const updateBlogValidator = Joi.object({
  title: Joi.string().trim().max(200).optional(),
  slug: Joi.string().trim().lowercase().optional(),
  shortDescription: Joi.string().trim().max(500).optional(),
  content: Joi.array().items(contentBlockValidator).min(1).optional(),
  tags: Joi.array().items(Joi.string().trim().lowercase()).optional(),
  status: Joi.string().valid("draft", "published", "archived").optional(),
  featured: Joi.boolean().optional(),
  permission: Joi.string().trim().required(),
  removeBannerImage: Joi.boolean().optional(),
});


/* ---------- ADD BLOG COMMENT VALIDATOR ---------- */
export const addBlogCommentValidator = Joi.object({
  name: Joi.string().trim().max(100).required(),

  company: Joi.string().trim().max(150).allow("").optional(),

  city: Joi.string().trim().max(100).allow("").optional(),

  review: Joi.string().trim().max(2000).required(),
});