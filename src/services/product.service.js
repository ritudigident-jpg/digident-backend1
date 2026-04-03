import { v6 as uuidv6 } from "uuid";
import Product from "../models/manage/product.model.js";
import Employee from "../models/manage/employee.model.js";
import { PermissionAudit } from "../models/manage/permissionaudit.model.js";
import { uploadToS3, deleteFromS3 } from "./awsS3.service.js";
/**
 * @function uploadFiles
 *
 * @description
 * Upload multiple files to S3 and track uploaded keys for rollback.
 */
const uploadFiles = async (files = [], folder, uploadedFiles = []) => {
  return Promise.all(
    files.map(async (file) => {
      if (!file) {
        throw new Error("Invalid file sent from frontend");
      }
      const uploaded = await uploadToS3(file, folder);
      if (!uploaded?.url) {
        throw new Error("File upload failed");
      }
      if (uploaded?.key) {
        uploadedFiles.push(uploaded.key);
      }
      return uploaded.url;
    })
  );
};

/**
 * @function addProductService
 *
 * @description
 * Service to create a product with:
 * - product images
 * - description images
 * - variant images
 * - specification ids
 * - variant ids
 * - attribute ids
 * - stock validation
 * - permission audit
 */
export const addProductService = async ({ body, files, user }) => {
  const uploadedFiles = [];
  console.log("Service called with body:----", body);
  try {
    /* ---------- VALIDATE USER ---------- */
    if (!user?.email) {
      throw new Error("Unauthorized user");
    }
    /* ---------- FETCH EMPLOYEE ---------- */
    const employee = await Employee.findOne({
      email: user.email,
      isDeleted: false,
    });

    if (!employee) {
      throw new Error("Employee not found");
    }

    /* ---------- INIT PRODUCT ---------- */
    body.productId = uuidv6();

    /* ---------- NORMALIZE ARRAYS ---------- */
    body.description = Array.isArray(body.description) ? body.description : [];
    body.specification = Array.isArray(body.specification) ? body.specification : [];
    body.variants = Array.isArray(body.variants) ? body.variants : [];
    /* ---------- PRODUCT IMAGES ---------- */
    if (files?.productImages?.length) {
      body.images = await uploadFiles(files.productImages, "products", uploadedFiles);
    } 
    console.log("After product images upload:----", uploadedFiles);
    /* ---------- DESCRIPTION IMAGES ---------- */
    const descFiles = files?.descriptionImages || [];
    const descMap = Array.isArray(body.descriptionImageMap)
      ? body.descriptionImageMap
      : [];

    const groupedDesc = {};

    descFiles.forEach((file, i) => {
      const idx = Number(descMap[i]);
      if (Number.isNaN(idx)) return;

      if (!groupedDesc[idx]) {
        groupedDesc[idx] = [];
      }
      groupedDesc[idx].push(file);
    });
console.log("Grouped description files:----", groupedDesc); 
    body.description = await Promise.all(
      body.description.map(async (desc, index) => {
        const paragraphFiles = groupedDesc[index] || [];
        const urls = paragraphFiles.length
          ? await uploadFiles(paragraphFiles, "products", uploadedFiles)
          : [];

        return {
          paragraphId: uuidv6(),
          text: desc?.text || "",
          image: urls,
        };
      })
    );

    /* ---------- SPECIFICATION ---------- */
    body.specification = body.specification.map((spec) => ({
      ...spec,
      specId: uuidv6(),
    }));
console.log("After specification processing:----");
    /* ---------- VARIANT IMAGES ---------- */
    const varFiles = files?.variantImages || [];
    const varMap = Array.isArray(body.variantImageMap)
      ? body.variantImageMap
      : [];

    const groupedVar = {};

    varFiles.forEach((file, i) => {
      const idx = Number(varMap[i]);
      if (Number.isNaN(idx)) return;

      if (!groupedVar[idx]) {
        groupedVar[idx] = [];
      }

      groupedVar[idx].push(file);
    });

    body.variants = await Promise.all(
      body.variants.map(async (variant, index) => {
        const variantFiles = groupedVar[index] || [];
        const urls = variantFiles.length
          ? await uploadFiles(variantFiles, "products", uploadedFiles)
          : [];
       console.log(`Variant ${index} files uploaded:----`, urls);
        return {
          ...variant,
          variantId: uuidv6(),
          variantImages: urls, // keep same as your old working code
          attributes: Array.isArray(variant.attributes)
            ? variant.attributes.map((attr) => ({
                ...attr,
                attrId: uuidv6(),
              }))
            : [],
          variantStock:
            body.stockType === "PRODUCT"
              ? undefined
              : variant.variantStock,
        };
      })
    );
console.log("After variants processing:----", body.variants);
    /* ---------- STOCK VALIDATION ---------- */
    if (
      body.stockType === "VARIANT" &&
      body.variants.some((variant) => variant.variantStock == null)
    ) {
      throw new Error(
        "Each variant must have its own stock when stockType is VARIANT"
      );
    }
    /* ---------- SAVE PRODUCT ---------- */
    console.log("Final product data to save:----",body);
    const product = await Product.create(body);

    /* ---------- AUDIT ---------- */
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: product._id,
      action: product.name,
      permission: body.permission || "create_product",
      actionType: "Create",
    });
    return product;
  } catch (error) {
    /* ---------- ROLLBACK UPLOADED FILES ---------- */
    // await Promise.all(uploadedFiles.map((key) => deleteFromS3(key)));
    throw new Error(error.message || "Failed to add product");
  }
};


export const updateProductService = async ({
  productId,
  body,
  files,
  user,
}) => {
  const uploadedFiles = [];

  try {
    /* ---------------- VALIDATION ---------------- */
    if (!productId) {
      throw new Error("productId is required");
    }

    /* ---------------- FETCH PRODUCT ---------------- */
    const product = await Product.findOne({ productId });
    if (!product) {
      throw new Error("Product not found");
    }

    /* ---------------- FETCH EMPLOYEE ---------------- */
    const employee = await Employee.findOne({ email: user?.email });
    if (!employee) {
      throw new Error("Employee not found");
    }

    /* ---------------- BASIC FIELD UPDATE ---------------- */
    const blockedFields = [
      "description",
      "variants",
      "removeImages",
      "removeDescImages",
      "removeVariantImages",
      "descriptionImageMap",
      "variantImageMap",
    ];

    for (const key of Object.keys(body)) {
      if (!blockedFields.includes(key) && body[key] !== undefined) {
        product[key] = body[key];
      }
    }

    /* =====================================================
       🖼 PRODUCT IMAGES
       ===================================================== */

    if (Array.isArray(body.removeImages)) {
      await Promise.all(body.removeImages.map((img) => deleteFromS3(img)));

      product.images = (product.images || []).filter(
        (img) => !body.removeImages.includes(img)
      );
    }

    if (files?.productImages?.length) {
      const urls = await uploadFiles(files.productImages, "products", uploadedFiles);
      product.images.push(...urls);
    }

    /* =====================================================
       📝 DESCRIPTION
       ===================================================== */

    if (Array.isArray(body.removeDescImages)) {
      await Promise.all(body.removeDescImages.map((img) => deleteFromS3(img)));

      product.description = (product.description || []).map((d) => ({
        ...d,
        image: (d.image || []).filter(
          (img) => !body.removeDescImages.includes(img)
        ),
      }));
    }

    if (Array.isArray(body.description)) {
      const descFiles = files?.descriptionImages || [];
      const descMap = Array.isArray(body.descriptionImageMap)
        ? body.descriptionImageMap
        : [];

      const grouped = {};

      descFiles.forEach((file, i) => {
        const idx = Number(descMap[i]);
        if (!grouped[idx]) grouped[idx] = [];
        grouped[idx].push(file);
      });

      product.description = await Promise.all(
        body.description.map(async (desc, index) => {
          const newFiles = grouped[index] || [];

          const urls = newFiles.length
            ? await uploadFiles(newFiles, "products", uploadedFiles)
            : desc.image || [];

          return {
            paragraphId: desc.paragraphId || uuidv6(),
            text: desc.text,
            image: urls,
          };
        })
      );
    }

    /* =====================================================
       🎨 VARIANTS
       ===================================================== */

    if (Array.isArray(body.removeVariantImages)) {
      await Promise.all(body.removeVariantImages.map((img) => deleteFromS3(img)));

      product.variants = (product.variants || []).map((v) => ({
        ...v,
        variantImages: (v.variantImages || []).filter(
          (img) => !body.removeVariantImages.includes(img)
        ),
      }));
    }

    if (Array.isArray(body.variants)) {
      const varFiles = files?.variantImages || [];
      const varMap = Array.isArray(body.variantImageMap)
        ? body.variantImageMap
        : [];

      const grouped = {};

      varFiles.forEach((file, i) => {
        const idx = Number(varMap[i]);
        if (!grouped[idx]) grouped[idx] = [];
        grouped[idx].push(file);
      });

      product.variants = await Promise.all(
        body.variants.map(async (variant, index) => {
          const newFiles = grouped[index] || [];

          const urls = newFiles.length
            ? await uploadFiles(newFiles, "products", uploadedFiles)
            : variant.variantImages || [];

          return {
            ...variant,
            variantId: variant.variantId || uuidv6(),
            variantImages: urls,
            attributes: Array.isArray(variant.attributes)
              ? variant.attributes.map((a) => ({
                  ...a,
                  attrId: a.attrId || uuidv6(),
                }))
              : [],
            variantStock:
              product.stockType === "PRODUCT"
                ? undefined
                : variant.variantStock,
          };
        })
      );
    }

    /* =====================================================
       📦 STOCK VALIDATION
       ===================================================== */

    if (
      product.stockType === "VARIANT" &&
      product.variants.some((v) => v.variantStock == null)
    ) {
      throw new Error("Each variant must have its own stock");
    }

    /* ---------------- SAVE ---------------- */
    await product.save();

    /* ---------------- AUDIT ---------------- */
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: product._id,
      action: product.name,
      permission: body.permission || "update_product",
      actionType: "Update",
    });

    return product;

  } catch (error) {
    /* ---------------- ROLLBACK UPLOADED FILES ---------------- */
    await Promise.all(uploadedFiles.map((key) => deleteFromS3(key)));

    throw new Error(error.message || "Failed to update product");
  }
};


export const getProductsByStatusService = async (query) => {
  try {
    /* ---------------- PAGINATION ---------------- */
    const { page = 1, limit = 10, skip = 0 } = query.pagination || {};

    /* ---------------- FILTERS ---------------- */
    const {
      search,
      category,
      brand,
      minPrice,
      maxPrice,
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = query.filters || {};

    /* ---------------- BUILD FILTER ---------------- */
    const filter = {};

    if (status && status !== "all") {
      filter.status = status;
    }

    if (search) {
      filter.name = { $regex: search.trim(), $options: "i" };
    }

    if (category) {
      filter.category = category;
    }

    if (brand) {
      filter.brand = brand;
    }

    if (minPrice != null || maxPrice != null) {
      filter.price = {};
      if (minPrice != null) filter.price.$gte = Number(minPrice);
      if (maxPrice != null) filter.price.$lte = Number(maxPrice);
    }

    /* ---------------- SORT ---------------- */
    const allowedSortFields = ["name", "price", "createdAt"];
    const safeSortBy = allowedSortFields.includes(sortBy)
      ? sortBy
      : "createdAt";

    const sortOptions = {
      [safeSortBy]: sortOrder === "asc" ? 1 : -1,
    };
    /* ---------------- QUERY ---------------- */
    const [products, totalProducts] = await Promise.all([
      Product.find(filter)
        .select("name price images brand category status productId createdAt")
        .populate("brand", "brandName logoUrl")
        .populate("category", "name")
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean(),

      Product.countDocuments(filter),
    ]);

    /* ---------------- RESPONSE ---------------- */
    const totalPages = Math.ceil(totalProducts / limit) || 1;

    return {
      products,
      totalProducts,
      totalPages,
      currentPage: page,
    };

  } catch (error) {
    throw new Error(error.message || "Failed to fetch products");
  }
};

export const getProductByIdService = async (productId) => {
  return await Product.findOne({ productId })
    .populate("brand", "brandName logoUrl")
    .populate("category", "name")
    .lean();
};


export const getBestSellerProductsService = async () => {
  try {
    const products = await Product.find(
      {
        status: "active",
        labels: { $in: ["best_selling"] },
      },
      {
        name: 1,
        price: 1,
        images: 1,
        brand: 1,
        category: 1,
        productId: 1,
      }
    )
      .populate("brand", "brandName")
      .populate("category", "name")
      .sort({ name: 1 })
      .lean();

    /* ---------------- OPTIONAL CHECK ---------------- */
    if (!products || products.length === 0) {
      throw new Error("No best seller products found");
    }

    return products;

  } catch (error) {
    throw new Error(error.message || "Failed to fetch best seller products");
  }
};


export const deleteProductService = async ({
  productId,
  userEmail,
  permission,
}) => {

  /* ---------------- VALIDATION ---------------- */
  if (!productId) {
    throw new Error("productId is required");
  }

  /* ---------------- FETCH PRODUCT ---------------- */
  const product = await Product.findOne({ productId });

  if (!product) {
    throw new Error("Product not found");
  }

  /* ---------------- FETCH EMPLOYEE ---------------- */
  const employee = await Employee.findOne({ email: userEmail });

  if (!employee) {
    throw new Error("Employee not found");
  }

  /* ---------------- DELETE PRODUCT ---------------- */
  await Product.deleteOne({ productId });

  /* ---------------- AUDIT LOG ---------------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: product._id,
    action: product.name,
    permission: permission || "delete_product",
    actionType: "Delete",
  });

  return product;
};


export const updateProductStockService = async ({
  productId,
  userEmail,
  stockType,
  productStock,
  variantStocks,
  permission,
}) => {

  /* ---------------- VALIDATION ---------------- */
  if (!productId) {
    throw new Error("productId is required");
  }

  if (!stockType || !["PRODUCT", "VARIANT"].includes(stockType)) {
    throw new Error("Invalid stockType");
  }

  /* ---------------- FETCH PRODUCT ---------------- */
  const product = await Product.findOne({ productId });

  if (!product) {
    throw new Error("Product not found");
  }

  /* ---------------- FETCH EMPLOYEE ---------------- */
  const employee = await Employee.findOne({ email: userEmail });

  if (!employee) {
    throw new Error("Employee not found");
  }

  /* ---------------- PRODUCT STOCK ---------------- */
  if (stockType === "PRODUCT") {
    if (productStock == null || productStock < 0) {
      throw new Error("Valid productStock is required");
    }

    product.stockType = "PRODUCT";
    product.productStock = productStock;

    // Reset all variant stock
    product.variants = product.variants.map((v) => ({
      ...v,
      variantStock: 0,
    }));
  }

  /* ---------------- VARIANT STOCK ---------------- */
  if (stockType === "VARIANT") {
    if (!Array.isArray(variantStocks) || variantStocks.length === 0) {
      throw new Error("variantStocks array is required");
    }

    product.stockType = "VARIANT";
    product.productStock = 0;

    for (const vs of variantStocks) {
      if (!vs.variantId) {
        throw new Error("variantId is required");
      }

      if (vs.stock == null || vs.stock < 0) {
        throw new Error("Variant stock must be non-negative");
      }

      const variant = product.variants.find(
        (v) => v.variantId.toString() === vs.variantId.toString()
      );

      if (!variant) {
        throw new Error(`Variant not found: ${vs.variantId}`);
      }

      variant.variantStock = vs.stock;
    }
  }

  /* ---------------- SAVE ---------------- */
  await product.save();

  /* ---------------- AUDIT ---------------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: product._id,
    action: `Stock Updated - ${product.name}`,
    permission: permission || "update_stock",
    actionType: "Update",
  });

  return product;
};

export const duplicateProductService = async ({
  productId,
  userEmail,
  permission,
}) => {
  /* ---------------- VALIDATION ---------------- */
  if (!productId) {
    throw new Error("productId is required");
  }

  /* ---------------- FETCH PRODUCT ---------------- */
  const originalProduct = await Product.findOne({ productId });

  if (!originalProduct) {
    throw new Error("Product not found");
  }

  /* ---------------- FETCH EMPLOYEE ---------------- */
  const employee = await Employee.findOne({ email: userEmail });

  if (!employee) {
    throw new Error("Employee not found");
  }

  /* ---------------- CLONE OBJECT ---------------- */
  const productData = originalProduct.toObject();

  /* ---------------- CLEAN FIELDS ---------------- */
  delete productData._id;
  delete productData.createdAt;
  delete productData.updatedAt;

  /* ---------------- NEW ID & NAME ---------------- */
  productData.productId = uuidv6();
  productData.name = `${originalProduct.name} Copy`;

  /* ---------------- DESCRIPTION ---------------- */
  if (Array.isArray(productData.description)) {
    productData.description = productData.description.map((desc) => ({
      ...desc,
      paragraphId: uuidv6(),
    }));
  }

  /* ---------------- SPECIFICATIONS ---------------- */
  if (Array.isArray(productData.specification)) {
    productData.specification = productData.specification.map((spec) => ({
      ...spec,
      specId: uuidv6(),
    }));
  }

  /* ---------------- VARIANTS ---------------- */
  if (Array.isArray(productData.variants)) {
    productData.variants = productData.variants.map((variant) => ({
      ...variant,
      variantId: uuidv6(),
      attributes: Array.isArray(variant.attributes)
        ? variant.attributes.map((attr) => ({
            ...attr,
            attrId: uuidv6(),
          }))
        : [],
    }));
  }

  /* ---------------- CREATE PRODUCT ---------------- */
  const newProduct = await Product.create(productData);

  /* ---------------- AUDIT ---------------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: newProduct._id,
    action: newProduct.name,
    permission: permission || "duplicate_product",
    actionType: "Create",
  });

  return newProduct;
};