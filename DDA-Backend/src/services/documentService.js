const prisma = require('../db');

/**
 * Service abstraction for database document operations
 */
class DocumentService {
  async create(userId, data) {
    return prisma.document.create({
      data: {
        userId,
        ...data,
      },
    });
  }

  async findByUserId(userId) {
    return prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdAndUserId(id, userId) {
    return prisma.document.findFirst({
      where: { id, userId },
    });
  }

  async update(id, userId, data) {
    return prisma.document.updateMany({
      where: { id, userId },
      data,
    });
  }

  async delete(id, userId) {
    return prisma.document.deleteMany({
      where: { id, userId },
    });
  }
}

module.exports = new DocumentService();
