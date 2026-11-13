import {Config} from "@/config";
import {Elysia} from "elysia";
import {UnauthorizedError} from "@/utils/error";
import {SignJWT, jwtVerify, type JWTPayload} from "jose";
import {roleEnum} from "@/database/entity/user.entity"
interface Payload extends JWTPayload {
    role: typeof roleEnum.enumValues[number]
    sid?: string
    ids?: string
    tenantId?: string
}

export class JwtUtil {
    private static readonly JWT_SECRET = new TextEncoder().encode(Config.application.secret);

    static readonly isAuthenticated = new Elysia()
        .derive({ as: "scoped" }, async ({headers: {authorization}}): Promise<{
            user: { iss: string, sid: string, tenantId: string, role: typeof roleEnum.enumValues[number] }
        }> => {
            if (!authorization || !authorization.startsWith("Bearer ")) {
                throw new UnauthorizedError("Token not found");
            }

            const token = authorization.split(" ")[1];
            try {
                const {payload} = await jwtVerify(token, JwtUtil.JWT_SECRET) as { payload: Payload };

                if (!payload || payload.iss == undefined) {
                    throw new UnauthorizedError("Your token is exp");
                }

                const tenantId = (payload.tenantId ?? payload.ids ?? payload.sid ?? "") as string;
                return {
                    user: {
                        iss: payload.iss,
                        sid: tenantId,
                        tenantId: tenantId,
                        role: payload.role
                    }
                }
            } catch (e) {
                if (e instanceof UnauthorizedError) throw e;
                throw new UnauthorizedError("Your token is exp");
            }
        })

    async register(value: { id: string, tenant: string, role: typeof roleEnum.enumValues[number] }) {
        const expiresIn = 7 * 24 * 60 * 60;
        const expTimestamp = Math.floor(Date.now() / 1000) + expiresIn;

        const payload = {
            iss: value.id,
            ids: value.tenant,
            sid: value.tenant,
            tenantId: value.tenant,
            role: value.role,
        }
        const token = await new SignJWT(payload)
            .setProtectedHeader({alg: 'HS256'})
            .setExpirationTime(expTimestamp)
            .sign(JwtUtil.JWT_SECRET);

        return {
            key: token,
            exp: expTimestamp
        }
    }
}