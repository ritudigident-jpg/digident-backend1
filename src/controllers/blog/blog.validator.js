import Joi from "joi";

/* ---------- CREATE BLOG VALIDATOR ---------- */
export const createBlogValidator = Joi.object({
  title: Joi.string().trim().max(200).required(),
  slug: Joi.string().trim().lowercase().optional(),
  shortDescription: Joi.string().trim().max(500).required(),
  bannerImage: Joi.object({
    url: Joi.string().trim().allow(""),
    key: Joi.string().trim().allow(""),
    alt: Joi.string().trim().allow(""),
  }).optional(),
  content: Joi.array()
    .items(
      Joi.object({
        type: Joi.string()
          .valid("heading", "paragraph", "image", "list", "quote")
          .required(),
        text: Joi.string().allow("").optional(),
        level: Joi.number().optional(),
        listItems: Joi.array().items(Joi.string().trim()).optional(),
        image: Joi.object({
          url: Joi.string().trim().allow(""),
          key: Joi.string().trim().allow(""),
          alt: Joi.string().trim().allow(""),
        }).optional(),
        order: Joi.number().optional(),
      })
    )
    .min(1)
    .required(),
  tags: Joi.array().items(Joi.string().trim().lowercase()).optional(),
  status: Joi.string().valid("draft", "published", "archived").optional(),
  featured: Joi.boolean().optional(),
  seo: Joi.object({
    metaTitle: Joi.string().trim().allow(""),
    metaDescription: Joi.string().trim().allow(""),
    keywords: Joi.array().items(Joi.string().trim()).optional(),
    canonicalUrl: Joi.string().trim().allow(""),
    ogImage: Joi.string().trim().allow(""),
  }).optional(),
});

/* ---------- ADD COMMENT VALIDATOR ---------- */
export const addBlogCommentValidator = Joi.object({
  name: Joi.string().trim().max(100).required(),
  company: Joi.string().trim().max(150).allow("").optional(),
  city: Joi.string().trim().max(100).allow("").optional(),
  review: Joi.string().trim().max(2000).required(),
});