// import slugify from "slugify";
// import { v6 as uuidv6 } from "uuid";
// import Blog from "../models/blog/blog.modal.js";
// import { PermissionAudit } from "../models/manage/permissionaudit.model.js";
// import { uploadToS3, deleteFromS3 } from "./awsS3.service.js";
// import { generateSEOContent } from "../helpers/blogSeo.helper.js";

// /* ---------- CALCULATE READING TIME ---------- */
// const calculateReadingTime = (content = []) => {
//   let totalWords = 0;

//   for (const block of content) {
//     if (block?.text) {
//       totalWords += block.text.trim().split(/\s+/).filter(Boolean).length;
//     }

//     if (Array.isArray(block?.listItems)) {
//       for (const item of block.listItems) {
//         totalWords += item.trim().split(/\s+/).filter(Boolean).length;
//       }
//     }
//   }

//   return Math.max(1, Math.ceil(totalWords / 200));
// };

// /* ---------- NORMALIZE TAGS ---------- */
// const normalizeTags = (tags = []) => {
//   if (!Array.isArray(tags)) return [];
//   return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
// };

// /* ---------- CLEANUP UPLOADED S3 KEYS ---------- */
// const cleanupS3Keys = async (keys = []) => {
//   for (const key of keys) {
//     if (!key) continue;
//     try {
//       await deleteFromS3(key);
//     } catch (cleanupError) {
//       console.error("S3 cleanup failed:", cleanupError.message);
//     }
//   }
// };

// /* ---------- GENERATE UNIQUE SLUG ---------- */
// const generateUniqueSlug = async ({
//   title = "",
//   customSlug = "",
//   currentBlogId = null,
// }) => {
//   const baseSource = String(customSlug || title || "").trim();

//   let baseSlug = slugify(baseSource, {
//     lower: true,
//     strict: true,
//     trim: true,
//   });

//   if (!baseSlug) {
//     baseSlug = `blog-${Date.now()}`;
//   }

//   let finalSlug = baseSlug;
//   let counter = 1;

//   while (
//     await Blog.exists({
//       slug: finalSlug,
//       ...(currentBlogId ? { _id: { $ne: currentBlogId } } : {}),
//     })
//   ) {
//     finalSlug = `${baseSlug}-${counter}`;
//     counter++;
//   }

//   return finalSlug;
// };

// /* ---------- BUILD CONTENT WITH S3 URLS ---------- */
// const buildContentWithUploads = async ({
//   content = [],
//   uploadedKeys = [],
//   contentImageFiles = [],
//   oldContent = [],
//   isUpdate = false,
// }) => {
//   const finalContent = [];

//   for (let i = 0; i < content.length; i++) {
//     const block = content[i];
//     let imageUrl = block.image || "";

//     if (typeof block.imageFileIndex === "number") {
//       const file = contentImageFiles[block.imageFileIndex];

//       if (!file) {
//         const err = new Error(
//           `Content image file not found for block index ${block.imageFileIndex}`
//         );
//         err.statusCode = 400;
//         err.errorCode = "CONTENT_IMAGE_NOT_FOUND";
//         throw err;
//       }

//       const uploaded = await uploadToS3(file, "blog/content");
//       imageUrl = uploaded.url;
//       if (uploaded.key) uploadedKeys.push(uploaded.key);
//     } else if (
//       isUpdate &&
//       !block.image &&
//       oldContent[i] &&
//       oldContent[i].type === "image" &&
//       oldContent[i].image
//     ) {
//       imageUrl = oldContent[i].image;
//     }

//     const oldBlock = isUpdate ? oldContent[i] : null;

//     finalContent.push({
//       ...(oldBlock?.blockId ? { blockId: oldBlock.blockId } : {}),
//       type: block.type,
//       text: block.text || "",
//       level: block.level || 2,
//       listItems: Array.isArray(block.listItems) ? block.listItems : [],
//       image: imageUrl,
//       order: typeof block.order === "number" ? block.order : i,
//     });
//   }

//   return finalContent;
// };

// /* ---------- CREATE BLOG SERVICE ---------- */
// export const createBlogService = async ({ data, files, employee }) => {
//   const uploadedKeys = [];

//   try {
//     const {
//       title,
//       shortDescription,
//       content,
//       slug,
//       tags = [],
//       status = "draft",
//       featured = false,
//       permission,
//     } = data;

//     const trimmedTitle = title.trim();
//     const trimmedShortDescription = shortDescription.trim();
//     const normalizedTags = normalizeTags(tags);

//     const exist = await Blog.findOne({
//       title: trimmedTitle,
//       isDeleted: false,
//     });

//     if (exist) {
//       const err = new Error("Blog already exists with this title");
//       err.statusCode = 409;
//       err.errorCode = "BLOG_ALREADY_EXISTS";
//       throw err;
//     }

//     const finalSlug = await generateUniqueSlug({
//       title: trimmedTitle,
//       customSlug: slug,
//     });

//     /* ---------- UPLOAD BANNER IMAGE ---------- */
//     let bannerImage = "";
//     if (files?.bannerImage?.[0]) {
//       const uploadedBanner = await uploadToS3(
//         files.bannerImage[0],
//         "blog/banner"
//       );
//       bannerImage = uploadedBanner.url;
//       if (uploadedBanner.key) uploadedKeys.push(uploadedBanner.key);
//     }

//     /* ---------- BUILD CONTENT WITH CONTENT IMAGE UPLOADS ---------- */
//     const finalContent = await buildContentWithUploads({
//       content,
//       uploadedKeys,
//       contentImageFiles: files?.contentImages || [],
//     });

//     /* ---------- AUTO GENERATE SEO ---------- */
//     const { seo, seoAnalysis } = generateSEOContent({
//       title: trimmedTitle,
//       shortDescription: trimmedShortDescription,
//       content: finalContent,
//       tags: normalizedTags,
//       slug: finalSlug,
//       bannerImage,
//       baseUrl: process.env.FRONTEND_URL || process.env.WEBSITE_URL || "",
//       brandName: process.env.BRAND_NAME || "",
//     });

//     /* ---------- CREATE BLOG ---------- */
//     const blog = await Blog.create({
//       title: trimmedTitle,
//       slug: finalSlug,
//       shortDescription: trimmedShortDescription,
//       bannerImage,
//       content: finalContent,
//       tags: normalizedTags,
//       status,
//       featured,
//       seo,
//       seoAnalysis,
//       readingTime: calculateReadingTime(finalContent),
//       publishedAt: status === "published" ? new Date() : null,
//     });

//     /* ---------- AUDIT ---------- */
//     await PermissionAudit.create({
//       permissionAuditId: uuidv6(),
//       actionBy: employee._id,
//       actionByEmail: employee.email,
//       actionFor: blog._id,
//       action: blog.title,
//       permission,
//       actionType: "Create",
//     });

//     return blog;
//   } catch (error) {
//     await cleanupS3Keys(uploadedKeys);
//     throw error;
//   }
// };

// /* ---------- UPDATE BLOG SERVICE ---------- */
// export const updateBlogService = async ({ blogId, data, files, employee }) => {
//   const uploadedKeys = [];
//   const oldKeysToDelete = [];
//   try {
//     const blog = await Blog.findOne({ blogId, isDeleted: false });
//     if (!blog) {
//       const err = new Error("Blog not found");
//       err.statusCode = 404;
//       err.errorCode = "BLOG_NOT_FOUND";
//       throw err;
//     }
//     const {
//       title,
//       slug,
//       shortDescription,
//       content,
//       tags,
//       status,
//       featured,
//       permission,
//       removeBannerImage = false,
//     } = data;

//     /* ---------- TITLE ---------- */
//     if (title !== undefined) {
//       blog.title = String(title).trim();
//     }
//     /* ---------- SHORT DESCRIPTION ---------- */
//     if (shortDescription !== undefined) {
//       blog.shortDescription = String(shortDescription).trim();
//     }
//     /* ---------- TAGS ---------- */
//     if (tags !== undefined) {
//       blog.tags = normalizeTags(tags);
//     }
//     /* ---------- FEATURED ---------- */
//     if (featured !== undefined) {
//       blog.featured = featured;
//     }
//     /* ---------- BANNER IMAGE REMOVE ---------- */
//     if (removeBannerImage && blog.bannerImage) {
//       oldKeysToDelete.push(blog.bannerImage);
//       blog.bannerImage = "";
//     }
//     /* ---------- BANNER IMAGE UPLOAD ---------- */
//     if (files?.bannerImage?.[0]) {
//       if (blog.bannerImage) {
//         oldKeysToDelete.push(blog.bannerImage);
//       }

//       const uploadedBanner = await uploadToS3(
//         files.bannerImage[0],
//         "blog/banner"
//       );

//       blog.bannerImage = uploadedBanner.url || "";
//       if (uploadedBanner.key) uploadedKeys.push(uploadedBanner.key);
//     }

//     /* ---------- CONTENT ---------- */
//     if (content !== undefined) {
//       const oldContentImages = Array.isArray(blog.content)
//         ? blog.content.map((item) => item?.image).filter(Boolean)
//         : [];

//       const finalContent = await buildContentWithUploads({
//         content,
//         contentImageFiles: files?.contentImages || [],
//         uploadedKeys,
//         oldContent: blog.content || [],
//         isUpdate: true,
//       });

//       blog.content = finalContent;

//       const newContentImages = finalContent
//         .map((item) => item?.image)
//         .filter(Boolean);

//       for (const oldImage of oldContentImages) {
//         if (!newContentImages.includes(oldImage)) {
//           oldKeysToDelete.push(oldImage);
//         }
//       }

//       blog.readingTime = calculateReadingTime(finalContent);
//     }
//     /* ---------- SLUG ---------- */
//     if (title !== undefined || slug !== undefined) {
//       blog.slug = await generateUniqueSlug({
//         title: blog.title,
//         customSlug: slug !== undefined ? slug : blog.slug,
//         currentBlogId: blog._id,
//       });
//     }
//     /* ---------- STATUS ---------- */
//     if (status !== undefined) {
//       blog.status = status;

//       if (status === "published" && !blog.publishedAt) {
//         blog.publishedAt = new Date();
//       }
//       if (status !== "published") {
//         blog.publishedAt = null;
//       }
//     }
//     if (content === undefined && (!blog.readingTime || blog.readingTime < 1)) {
//       blog.readingTime = calculateReadingTime(blog.content || []);
//     }

//     /* ---------- AUTO REGENERATE SEO ---------- */
//     const { seo, seoAnalysis } = generateSEOContent({
//       title: blog.title || "",
//       shortDescription: blog.shortDescription || "",
//       content: blog.content || [],
//       tags: blog.tags || [],
//       slug: blog.slug || "",
//       bannerImage: blog.bannerImage || "",
//       baseUrl: process.env.FRONTEND_URL || process.env.WEBSITE_URL || "",
//       brandName: process.env.BRAND_NAME || "",
//     });
//     blog.seo = seo;
//     blog.seoAnalysis = seoAnalysis;
//     await blog.save();
//     /* ---------- AUDIT ---------- */
//     await PermissionAudit.create({
//       permissionAuditId: uuidv6(),
//       actionBy: employee._id,
//       actionByEmail: employee.email,
//       actionFor: blog._id,
//       action: blog.title,
//       permission,
//       actionType: "Update",
//     });
//     await cleanupS3Keys([...new Set(oldKeysToDelete.filter(Boolean))]);
//     return blog;
//   } catch (error) {
//     await cleanupS3Keys(uploadedKeys);
//     throw error;
//   }
// };

// /* ---------- GET BLOGS SERVICE ---------- */
// export const getBlogsService = async (query) => {
//   const page = Math.max(parseInt(query.page) || 1, 1);
//   const limit = Math.min(Math.max(parseInt(query.limit) || 10, 1), 100);
//   const skip = (page - 1) * limit;

//   const {
//     search,
//     status,
//     featured,
//     sortBy = "createdAt",
//     sortOrder = "desc",
//   } = query;

//   const filter = {
//     isDeleted: false,
//   };

//   /* ---------- SEARCH FILTER ---------- */
//   if (search?.trim()) {
//     filter.$or = [
//       { title: { $regex: search.trim(), $options: "i" } },
//       { shortDescription: { $regex: search.trim(), $options: "i" } },
//       { tags: { $regex: search.trim(), $options: "i" } },
//     ];
//   }

//   /* ---------- STATUS FILTER ---------- */
//   if (status && ["draft", "published", "archived"].includes(status)) {
//     filter.status = status;
//   }

//   /* ---------- FEATURED FILTER ---------- */
//   if (featured !== undefined) {
//     if (featured === "true" || featured === true) {
//       filter.featured = true;
//     } else if (featured === "false" || featured === false) {
//       filter.featured = false;
//     }
//   }

//   /* ---------- SORT ---------- */
//   const allowedSortFields = [
//     "title",
//     "createdAt",
//     "updatedAt",
//     "publishedAt",
//   ];

//   const finalSortBy = allowedSortFields.includes(sortBy)
//     ? sortBy
//     : "createdAt";
//   const finalSortOrder = sortOrder === "asc" ? 1 : -1;
//   const [blogs, totalItems] = await Promise.all([
//     Blog.find(filter)
//       .select({
//         _id: 1,
//         blogId: 1,
//         title: 1,
//         slug: 1,
//         shortDescription: 1,
//         bannerImage: 1,
//         tags: 1,
//         status: 1,
//         featured: 1,
//         stats: 1,
//         readingTime: 1,
//         publishedAt: 1,
//         createdAt: 1,
//         updatedAt: 1,
//       })
//       .sort({ [finalSortBy]: finalSortOrder })
//       .skip(skip)
//       .limit(limit)
//       .lean(),
//     Blog.countDocuments(filter),
//   ]);
// const totalPages = Math.ceil(totalItems / limit);
// return {
//   pagination: {
//     totalItems,
//     totalPages,
//     currentPage: page,
//     nextPage: page < totalPages ? page + 1 : null,
//     prevPage: page > 1 ? page - 1 : null,
//     limit,
//   },
//   blogs,
//   };
// };

import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import { v6 as uuidv6 } from "uuid";
import Blog from "../models/blog/blog.modal.js";
import { uploadToS3 } from "./awsS3.service.js"; // use your existing uploadToS3 helper


// /* ---------- INCREASE BLOG VIEW SERVICE ---------- */
export const increaseBlogViewService = async ({ blogId }) => {
  const blog = await Blog.findOne({
    blogId,
    status: "published",
    isDeleted: false,
  });

  if (!blog) {
    const err = new Error("Blog not found");
    err.statusCode = 404;
    throw err;
  }

  blog.stats.views = (blog.stats?.views || 0) + 1;
  await blog.save();

  return {
    blogId: blog.blogId,
    slug: blog.slug,
    views: blog.stats.views,
  };
};

// /* ---------- GET BLOG BY ID SERVICE ---------- */
// export const getBlogByIdService = async (blogId) => {
//   const blog = await Blog.findOne({
//     blogId,
//     isDeleted: false,
//   }).lean();

//   if (!blog) {
//     const err = new Error("Blog not found");
//     err.statusCode = 404;
//     throw err;
//   }

//   return blog;
// };



// /* ---------- DELETE BLOG SERVICE ---------- */
// export const deleteBlogService = async ({ blogId, employee, permission }) => {
//   const blog = await Blog.findOne({ blogId });

//   if (!blog) {
//     const err = new Error("Blog not found");
//     err.statusCode = 404;
//     throw err;
//   }

//   /* ---------- COLLECT IMAGES ---------- */
//   const imagesToDelete = [];

//   if (blog.bannerImage) {
//     imagesToDelete.push(blog.bannerImage);
//   }

//   if (Array.isArray(blog.content)) {
//     for (const block of blog.content) {
//       if (block.image) {
//         imagesToDelete.push(block.image);
//       }
//     }
//   }

//   /* ---------- DELETE S3 IMAGES ---------- */
//   for (const image of imagesToDelete) {
//     try {
//       await deleteFromS3(image);
//     } catch (error) {
//       console.error("S3 delete failed:", error.message);
//       const err = new Error("Failed to delete blog images from storage");
//       err.statusCode = 500;
//       throw err;
//     }
//   }

//   /* ---------- DELETE BLOG DOCUMENT ---------- */
//   await Blog.deleteOne({ _id: blog._id });

//   /* ---------- AUDIT ---------- */
//   await PermissionAudit.create({
//     permissionAuditId: uuidv6(),
//     actionBy: employee._id,
//     actionByEmail: employee.email,
//     actionFor: blog._id,
//     action: blog.title,
//     permission,
//     actionType: "Delete",
//   });

//   return {
//     blogId: blog.blogId,
//     title: blog.title,
//   };
// };


/* ---------- ADD BLOG COMMENT SERVICE ---------- */
export const addBlogCommentService = async ({ blogId, data }) => {
  const blog = await Blog.findOne({
    blogId,
    status: "published",
  });

  if (!blog) {
    const err = new Error("Blog not found");
    err.statusCode = 404;
    throw err;
  }

  const comment = {
    name: data.name.trim(),
    company: data.company?.trim() || "",
    city: data.city?.trim() || "",
    review: data.review.trim(),
  };

  blog.comments.push(comment);
  blog.stats.commentsCount = (blog.stats.commentsCount || 0) + 1;

  await blog.save();

  return blog.comments[blog.comments.length - 1];
};


/* ---------- DELETE BLOG COMMENT SERVICE ---------- */
export const deleteBlogCommentService = async ({
  blogId,
  commentId,
  employee,
  permission,
}) => {
  const blog = await Blog.findOne({
    blogId,
    isDeleted: false,
  });

  if (!blog) {
    const err = new Error("Blog not found");
    err.statusCode = 404;
    throw err;
  }

  const commentIndex = blog.comments.findIndex(
    (comment) => comment.commentId === commentId
  );

  if (commentIndex === -1) {
    const err = new Error("Comment not found");
    err.statusCode = 404;
    throw err;
  }

  const deletedComment = blog.comments[commentIndex];

  /* ---------- REMOVE COMMENT ---------- */
  blog.comments.splice(commentIndex, 1);

  /* ---------- UPDATE COMMENT COUNT ---------- */
  blog.stats.commentsCount = Math.max(
    0,
    (blog.stats.commentsCount || 0) - 1
  );

  await blog.save();

  /* ---------- AUDIT ---------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: blog._id,
    action: `${blog.title} - ${deletedComment.name}`,
    permission,
    actionType: "Delete Comment",
  });

  return {
    blogId: blog.blogId,
    commentId: deletedComment.commentId,
    deletedComment: {
      name: deletedComment.name,
      company: deletedComment.company,
      city: deletedComment.city,
      review: deletedComment.review,
    },
    commentsCount: blog.stats.commentsCount,
  };
};

/**
 * @function extractMarkdownImageUrls
 * @description Extract all image URLs from markdown
 */
const extractMarkdownImageUrls = (markdown = "") => {
  const imageRegex = /!\[[^\]]*?\]\((.*?)\)/g;
  const urls = [];
  let match;
  while ((match = imageRegex.exec(markdown)) !== null) {
    if (match[1]) {
      urls.push(match[1].trim());
    }
  }

  return [...new Set(urls)];
};

/**
 * @function isValidRemoteImageUrl
 * @description Check whether image URL is valid http/https and not already s3
 */
const isValidRemoteImageUrl = (url = "") => {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.includes("amazonaws.com")) return false;
  return true;
};

/**
 * @function getFileExtensionFromUrl
 * @description Safely extract file extension from image url
 */
const getFileExtensionFromUrl = (url = "") => {
  try {
    const cleanUrl = url.split("?")[0].split("#")[0];
    const ext = path.extname(cleanUrl).toLowerCase();

    if (ext && ext.length <= 10) return ext;
    return ".jpg";
  } catch (error) {
    return ".jpg";
  }
};

/**
 * @function downloadImageToTemp
 * @description Download remote image into temp file
 */
const downloadImageToTemp = async (url) => {
  const ext = getFileExtensionFromUrl(url);
  const fileName = `${uuidv6()}${ext}`;
  const tempPath = path.join(os.tmpdir(), fileName);

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
  });

  fs.writeFileSync(tempPath, response.data);

  return tempPath;
};

/**
 * @function replaceMarkdownImageUrlsWithS3
 * @description Download markdown images, upload to s3 and replace urls inside markdown
 */
const replaceMarkdownImageUrlsWithS3 = async (markdown = "") => {
  if (!markdown || typeof markdown !== "string") {
    return markdown;
  }

  const imageUrls = extractMarkdownImageUrls(markdown);
  if (!imageUrls.length) return markdown;

  let updatedMarkdown = markdown;

  for (const imageUrl of imageUrls) {
    if (!isValidRemoteImageUrl(imageUrl)) continue;

    let tempPath = "";

    try {
      tempPath = await downloadImageToTemp(imageUrl);
      const fileForUpload = {
        path: tempPath,
        originalname: path.basename(tempPath),
        mimetype: "image/*",
      };
      const uploaded = await uploadToS3(fileForUpload, "blogs");
      if (uploaded?.url) {
        updatedMarkdown = updatedMarkdown.split(imageUrl).join(uploaded.url);
      }
    } catch (error) {
      console.error(`Failed to process blog image: ${imageUrl}`, error.message);
    } finally {
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  }
  return updatedMarkdown;
};

/**
 * @function createBlogService
 * @description Process markdown images and create blog
 */
export const createBlogService = async ({ data }) => {
  const processedContent = await replaceMarkdownImageUrlsWithS3(data.content);
  const blog = await Blog.create({
    content: processedContent,
  });
  return blog;
};

/**
 * @function updateBlogService
 * @description Process markdown images and update blog by blogId
 */
export const updateBlogService = async ({ blogId, data }) => {
  const existingBlog = await Blog.findOne({ blogId });
  if(!existingBlog) {
    const error = new Error("Blog not found");
    error.statusCode = 404;
    error.errorCode = "BLOG_NOT_FOUND";
    throw error;
  }
  const processedContent = await replaceMarkdownImageUrlsWithS3(data.content);
  existingBlog.content = processedContent;
  await existingBlog.save();
  return existingBlog;
};

/**
 * @function getBlogsService
 * @description Get all blogs latest first
 */
export const getBlogsService = async () => {
  const blogs = await Blog.find().sort({ createdAt: -1 }).lean();
  return blogs;
};

/**
 * @function getBlogByIdService
 * @description Get single blog by blogId
 */
export const getBlogByIdService = async ({ blogId }) => {
  const blog = await Blog.findOne({ blogId }).lean();
  if (!blog) {
    const error = new Error("Blog not found");
    error.statusCode = 404;
    error.errorCode = "BLOG_NOT_FOUND";
    throw error;
  }
  return blog;
};

/**
 * @function deleteBlogService
 * @description Delete single blog by blogId
 */
export const deleteBlogService = async ({ blogId }) => {
  const blog = await Blog.findOneAndDelete({ blogId });
  if (!blog) {
    const error = new Error("Blog not found");
    error.statusCode = 404;
    error.errorCode = "BLOG_NOT_FOUND";
    throw error;
  }
  return blog;
};