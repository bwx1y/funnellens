export class PasswordUtil {
    static async hash(password: string): Promise<string> {
        return Bun.password.hash(password, {
            algorithm: "bcrypt",
            cost: 10
        })
    }

    static async verify(password: string, hash: string): Promise<boolean> {
        return Bun.password.verify(password, hash)
    }
}