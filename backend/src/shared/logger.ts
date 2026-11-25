import pino from "pino";
import {Config} from "@/config";

const getLogLevel = () => {
    switch (Config.application.mode) {
        case 'production':
            return 'warn'
        case 'test':
            return 'silent'
        default:
            return 'debug'
    }
}

const level = getLogLevel() || 'info'

// ponytail: pino-roll file rotation, limit 5MB per file; add compression/archive if disk constrained.
export const logger = pino(
    {level},
    pino.transport({
        targets: [
            {
                target: 'pino-pretty',
                level,
                options: {
                    colorize: true,
                    translateTime: 'SYS:HH:MM:ss',
                    ignore: 'pid,hostname'
                }
            },
            {
                target: 'pino-roll',
                level,
                options: {
                    file: 'log/app',
                    size: '5m',
                    mkdir: true
                }
            }
        ]
    })
)