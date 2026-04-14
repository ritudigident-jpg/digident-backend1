import Blog from "../../models/blog/blog.model.js";
import slugify from "slugify";

const calculateReadingTime = (content = []) => {
  let totalWords = 0;

  for (const block of content) {
    if (block?.text) {
      totalWords += block.text.trim().split(/\s+/).filter(Boolean).length;
    }

    if (Array.isArray(block?.listItems)) {
      for (const item of block.listItems) {
        totalWords += item.trim().split(/\s+/).filter(Boolean).length;
      }
    }
  }

  return Math.max(1, Math.ceil(totalWords / 200));
};

const generateUniqueSlug = async (title, customSlug = "") => {
  const baseSlug = slugify(customSlug || title, {
    lower: true,
    strict: true,
    trim: true,
  });

  let finalSlug = baseSlug;
  let counter = 1;

  while (await Blog.findOne({ slug: finalSlug, isDeleted: false })) {
    counter += 1;
    finalSlug = `${baseSlug}-${counter}`;
  }

  return finalSlug;
};

export const createBlogService = async (data) => {
  const slug = await generateUniqueSlug(data.title, data.slug);
  const readingTime = calculateReadingTime(data.content);

  const blog = await Blog.create({
    title: data.title,
    slug,
    shortDescription: data.shortDescription,
    bannerImage: data.bannerImage || {},
    content: data.content || [],
    tags: data.tags || [],
    status: data.status || "draft",
    featured: data.featured || false,
    seo: data.seo || {},
    readingTime,
    publishedAt: data.status === "published" ? new Date() : null,
  });

  return blog;
};