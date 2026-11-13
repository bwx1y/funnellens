import {UserRepository} from "@/database/repository/user.repository";
import {TenantRepository} from "@/database/repository/tenant.repository";
import {UserTokenRepository} from "@/database/repository/user-token.repository";
import {AuthSchema} from "@/modules/auth/schema";
import {BadRequestError} from "@/utils/error";
import {JwtUtil} from "@/utils/jwt";
import {PasswordUtil} from "@/utils/password";
import {QueueManager} from "@/utils/queue";
import type {SendEmailTokenJob} from "@/modules/auth/worker";

export class AuthService {
    static readonly QUEUE_NAME = "email-queue";

    private readonly userRepository = new UserRepository();
    private readonly tenantRepository = new TenantRepository();
    private readonly userTokenRepository = new UserTokenRepository();
    private readonly jwtUtil = new JwtUtil();
    private readonly emailQueue = new QueueManager<SendEmailTokenJob>(AuthService.QUEUE_NAME);

    async login(body: AuthSchema["login"]) {
        const entity = await this.userRepository.findOneByEmail(body.email)
        if (entity == null) {
            throw new BadRequestError("Email not found");
        }

        const verifyPassword = await PasswordUtil.verify(body.password, entity.user.hashPassword)
        if (!verifyPassword) {
            throw new BadRequestError("Passwords do not match");
        }

        const token = await this.jwtUtil.register({
            id: entity.user.id,
            tenant: entity.tenant.id,
            role: entity.user.role ?? "ADMIN"
        })

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
            token: token,
        }
    }

    async register(body: AuthSchema["register"]) {
        const findTenant = await this.tenantRepository.findOneByName(body.tenant.name);
        if (findTenant != null) {
            throw new BadRequestError("Tenant already exists");
        }

        const findUser = await this.userRepository.findOneByEmail(body.email)
        if (findUser != null) {
            throw new BadRequestError("User already exists");
        }

        const entityTenant = await this.tenantRepository.create({
            name: body.tenant.name,
            address: body.tenant.address
        })
        const hashPassword = await PasswordUtil.hash(body.confirmPassword)
        const entityUser = await this.userRepository.create({
            fullName: body.fullName,
            email: body.email,
            hashPassword: hashPassword,
            tenantId: entityTenant.id,
        });

        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        await this.userTokenRepository.create({
            code: verificationCode,
            type: "EMAIL_VERIFICATION",
            userId: entityUser.id,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
        await this.emailQueue.add("send-verification", {
            type: "verification",
            to: entityUser.email,
            name: entityUser.fullName,
            code: verificationCode,
        });


        const token = await this.jwtUtil.register({
            role: entityUser.role!,
            tenant: entityTenant.id,
            id: entityUser.id,
        })

        return {
            id: entityUser.id,
            email: entityUser.email,
            fullName: entityUser.fullName,
            role: entityUser.role,
            isVerified: entityUser.isVerified,
            tenant: {
                id: entityTenant.id,
                name: entityTenant.name,
                address: entityTenant.address,
            },
            token: token,
        }
    }

    async forgotPassword(body: AuthSchema["forgotPassword"]) {
        const entity = await this.userRepository.findOneByEmail(body.email);
        if (!entity) {
            throw new BadRequestError("Email not found");
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await this.userTokenRepository.create({
            code,
            type: "PASSWORD_RESET",
            userId: entity.user.id,
            expiresAt
        });
        await this.emailQueue.add("send-reset-password", {
            type: "reset-password",
            to: entity.user.email,
            name: entity.user.fullName,
            code,
        });


        return {
            message: "Reset code sent successfully"
        };
    }

    async resetPassword(body: AuthSchema["resetPassword"]) {
        const entity = await this.userRepository.findOneByEmail(body.email);
        if (!entity) {
            throw new BadRequestError("Email not found");
        }

        const token = await this.userTokenRepository.findValid(body.code, "PASSWORD_RESET", entity.user.id);
        if (!token) {
            throw new BadRequestError("Invalid or expired code");
        }

        const hashPassword = await PasswordUtil.hash(body.newPassword);
        await this.userRepository.update(entity.user.id, {hashPassword});
        await this.userTokenRepository.markAsUsed(token.id);

        return {
            message: "Password reset successfully"
        };
    }

    async verifyEmail(body: AuthSchema["verifyEmail"]) {
        const entity = await this.userRepository.findOneByEmail(body.email);
        if (!entity) {
            throw new BadRequestError("Email not found");
        }

        if (entity.user.isVerified) {
            throw new BadRequestError("Email already verified");
        }

        const token = await this.userTokenRepository.findValid(body.code, "EMAIL_VERIFICATION", entity.user.id);
        if (!token) {
            throw new BadRequestError("Invalid or expired code");
        }

        await this.userRepository.update(entity.user.id, {isVerified: new Date()});
        await this.userTokenRepository.markAsUsed(token.id);

        return {
            message: "Email verified successfully"
        };
    }

    async resendVerification(body: AuthSchema["resendVerification"]) {
        const entity = await this.userRepository.findOneByEmail(body.email);
        if (!entity) {
            throw new BadRequestError("Email not found");
        }

        if (entity.user.isVerified) {
            throw new BadRequestError("Email already verified");
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await this.userTokenRepository.create({
            code,
            type: "EMAIL_VERIFICATION",
            userId: entity.user.id,
            expiresAt
        });

        await this.emailQueue.add("send-verification", {
            type: "verification",
            to: entity.user.email,
            name: entity.user.fullName,
            code,
        });

        return {
            message: "Verification code sent successfully"
        };
    }
}