import {UserRepository} from "@/database/repository/user.repository";
import {UnauthorizedError, BadRequestError} from "@/utils/error";
import {PasswordUtil} from "@/utils/password";
import {ProfileSchema} from "@/modules/profile/schema";
export class ProfileService {
    private readonly userRepository = new UserRepository();

    async get(id: string) {
        const entity = await this.userRepository.findOneById(id)
        if (!entity) {
            throw new UnauthorizedError()
        }

        return {
            id: entity.user.id,
            email: entity.user.email,
            fullName: entity.user.fullName,
            role: entity.user.role,
            isVerified: entity.user.isVerified,
            tenant: {
                id: entity.tenant.id,
                name: entity.tenant.name,
                address: entity.tenant.address,
            },
        }
    }

    async update(id: string, body: ProfileSchema["update"]) {
        const updated = await this.userRepository.update(id, body);
        if (!updated) {
            throw new UnauthorizedError();
        }

        return this.get(id);
    }

    async updatePassword(id: string, body: ProfileSchema["updatePassword"]) {
        const entity = await this.userRepository.findOneById(id);
        if (!entity) {
            throw new UnauthorizedError();
        }

        const isValid = await PasswordUtil.verify(body.oldPassword, entity.user.hashPassword);
        if (!isValid) {
            throw new BadRequestError("Old password is incorrect");
        }

        const hashPassword = await PasswordUtil.hash(body.newPassword);
        await this.userRepository.update(id, { hashPassword });

        return {
            message: "Password updated successfully"
        };
    }
}