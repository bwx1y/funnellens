import {Queue, type JobsOptions, type Job, Worker, type WorkerOptions} from "bullmq";

export type {Job, JobsOptions};
import {redisConnection} from "@/utils/redis";
import {logger} from "@/utils/logger";

/**
 * Generic wrapper class for managing BullMQ queues.
 */
export class QueueManager<
    TData = any,
    TResult = any,
    TName extends string = string
> {
    private readonly queue: Queue<TData, TResult, TName, TData, TResult, TName>;

    constructor(
        readonly queueName: string,
        private readonly defaultOptions?: JobsOptions
    ) {
        this.queue = new Queue<TData, TResult, TName, TData, TResult, TName>(queueName, {
            connection: redisConnection,
        });
    }

    /**
     * Adds a new job to the queue.
     */
    async add(jobName: TName, data: TData, options?: JobsOptions): Promise<Job<TData, TResult, TName>> {
        return await this.queue.add(jobName, data, {
            ...this.defaultOptions,
            ...options,
        });
    }

    /**
     * Returns the underlying raw BullMQ Queue instance.
     */
    get instance(): Queue<TData, TResult, TName, TData, TResult, TName> {
        return this.queue;
    }

    /**
     * Closes the queue connection.
     */
    async close(): Promise<void> {
        await this.queue.close();
    }
}

export class WorkerManager<TData = any, TResult = any, TName extends string = string> {
    private readonly worker: Worker<TData, TResult, TName>;

    constructor(queueName: string, processor: (job: Job<TData, TResult, TName>) => Promise<TResult>, options?: WorkerOptions) {
        this.worker = new Worker<TData, TResult, TName>(queueName, processor, {
            connection: redisConnection,
            ...options,
        });

        this.worker.on("completed", (job) => {
            logger.info(`[Worker] Job #${job.id} (${job.name}) selesai diproses.`);
        });

        this.worker.on("failed", (job, err) => {
            logger.error(`[Worker] Job #${job?.id} (${job?.name}) gagal: ${err.message}`);
        });
    }
}