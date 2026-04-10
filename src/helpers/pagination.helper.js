// export const getPagination = (query) => {
//   const page = parseInt(query.page) || 1;
//   const limit = Math.min(parseInt(query.limit) || 12); // default 12
//   const skip = (page - 1) * limit;
//   return { page, limit, skip };
// };

export const getPagination = (query) => {
  const page = parseInt(query.page) || 1;
  const limit = Math.min(parseInt(query.limit) || 12); // default 12
  const skip = (page - 1) * limit;
  const totalPages = Math.ceil(total / limit);
  return {
    totalItems: total,
    totalPages,
    currentPage: page,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
  };
};