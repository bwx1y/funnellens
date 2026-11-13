// ponytail: pagination dan filtering lanjutan di-skip; tambah saat list user per tenant butuh paging (>100 users).
import {UserRepository} from "@/database/repository/user.repository";
import {UserSchema} from "@/modules/user/schema";
import {BadRequestError, NotFoundError} from "@/utils/error";
import {PasswordUtil} from "@/utils/password";

export class UserService {
    private readonly userRepository = new UserRepository();

    async findAll(tenantId: string) {
        return this.userRepository.findAllByTenantId(tenantId);
    }

    async findById(id: string, tenantId: string) {
        const user = await this.userRepository.findByIdAndTenantId(id, tenantId);
        if (!user) {
            throw new NotFoundError("User not found");
        }
        return user;
    }

    async create(tenantId: string, body: UserSchema["create"]) {
        const existing = await this.userRepository.findOneByEmail(body.email);
        if (existing) {
            throw new BadRequestError("Email already in use");
        }

        const hashPassword = await PasswordUtil.hash(body.password);
        const entity = await this.userRepository.create({
            fullName: body.fullName,
            email: body.email,
            hashPassword,
            tenantId,
            role: body.role ?? "ADMIN",
            isVerified: new Date(),
        });

        return {
            id: entity.id,
            fullName: entity.fullName,
            email: entity.email,
            role: entity.role,
            isVerified: entity.isVerified,
            tenantId: entity.tenantId,
        };
    }

    async update(id: string, tenantId: string, body: UserSchema["update"]) {
        const user = await this.userRepository.findByIdAndTenantId(id, tenantId);
        if (!user) {
            throw new NotFoundError("User not found");
        }

        if (body.email && body.email !== user.email) {
            const existing = await this.userRepository.findOneByEmail(body.email);
            if (existing) {
                throw new BadRequestError("Email already in use");
            }
        }

        const updateData: {
            fullName?: string;
            email?: string;
            role?: "ADMIN" | "MANAGER";
            hashPassword?: string;
        } = {};

        if (body.fullName !== undefined) updateData.fullName = body.fullName;
        if (body.email !== undefined) updateData.email = body.email;
        if (body.role !== undefined) updateData.role = body.role;
        if (body.password !== undefined) {
            updateData.hashPassword = await PasswordUtil.hash(body.password);
        }

        const updated = await this.userRepository.updateByTenantId(id, tenantId, updateData);
        if (!updated) {
            throw new NotFoundError("User not found");
        }

        return updated;
    }

    async delete(id: string, currentUserId: string, tenantId: string) {
        if (id === currentUserId) {
            throw new BadRequestError("Cannot delete your own account");
        }

        const user = await this.userRepository.findByIdAndTenantId(id, tenantId);
        if (!user) {
            throw new NotFoundError("User not found");
        }

        await this.userRepository.deleteByTenantId(id, tenantId);

        return {
            message: "User deleted successfully"
        };
    }
}
