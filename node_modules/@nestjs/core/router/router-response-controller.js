"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouterResponseController = void 0;
const common_1 = require("@nestjs/common");
const shared_utils_1 = require("@nestjs/common/utils/shared.utils");
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
const sse_stream_1 = require("./sse-stream");
class RouterResponseController {
    constructor(applicationRef) {
        this.applicationRef = applicationRef;
        this.logger = new common_1.Logger(RouterResponseController.name);
    }
    async apply(result, response, httpStatusCode) {
        return this.applicationRef.reply(response, result, httpStatusCode);
    }
    async redirect(resultOrDeferred, response, redirectResponse) {
        const result = await this.transformToResult(resultOrDeferred);
        const statusCode = result && result.statusCode
            ? result.statusCode
            : redirectResponse.statusCode
                ? redirectResponse.statusCode
                : common_1.HttpStatus.FOUND;
        const url = result && result.url ? result.url : redirectResponse.url;
        this.applicationRef.redirect(response, statusCode, url);
    }
    async render(resultOrDeferred, response, template) {
        const result = await this.transformToResult(resultOrDeferred);
        return this.applicationRef.render(response, template, result);
    }
    async transformToResult(resultOrDeferred) {
        if ((0, rxjs_1.isObservable)(resultOrDeferred)) {
            return (0, rxjs_1.lastValueFrom)(resultOrDeferred);
        }
        return resultOrDeferred;
    }
    getStatusByMethod(requestMethod) {
        switch (requestMethod) {
            case common_1.RequestMethod.POST:
                return common_1.HttpStatus.CREATED;
            default:
                return common_1.HttpStatus.OK;
        }
    }
    setHeaders(response, headers) {
        headers.forEach(({ name, value }) => this.applicationRef.setHeader(response, name, typeof value === 'function' ? value() : value));
    }
    setStatus(response, statusCode) {
        this.applicationRef.status(response, statusCode);
    }
    async sse(result, response, request, options) {
        // It's possible that we sent headers already so don't use a stream
        if (response.writableEnded) {
            return;
        }
        const observableResult = await Promise.resolve(result);
        this.assertObservable(observableResult);
        const stream = new sse_stream_1.SseStream(request);
        const statusCode = options?.statusCode ??
            response.statusCode ??
            200;
        stream.pipe(response, {
            additionalHeaders: options?.additionalHeaders,
            statusCode,
        });
        return new Promise((resolve, reject) => {
            let settled = false;
            const onClose = () => {
                settled = true;
                subscription.unsubscribe();
                if (!stream.writableEnded) {
                    stream.end();
                }
                response.end();
                resolve();
            };
            const subscription = observableResult
                .pipe((0, operators_1.map)((message) => {
                if ((0, shared_utils_1.isObject)(message)) {
                    return message;
                }
                return { data: message };
            }), (0, operators_1.concatMap)(message => new Promise(resolve => stream.writeMessage(message, () => resolve()))), (0, operators_1.catchError)(err => {
                if (!stream.headersCommitted) {
                    throw err;
                }
                const data = err instanceof Error ? err.message : err;
                stream.writeMessage({ type: 'error', data }, writeError => {
                    if (writeError) {
                        this.logger.error(writeError);
                    }
                });
                return rxjs_1.EMPTY;
            }))
                .subscribe({
                error: err => {
                    settled = true;
                    request.removeListener('close', onClose);
                    if (!stream.writableEnded) {
                        stream.end();
                    }
                    reject(err);
                },
                complete: () => {
                    settled = true;
                    request.removeListener('close', onClose);
                    if (!stream.writableEnded) {
                        stream.end();
                    }
                    resolve();
                },
            });
            // Commit SSE headers on the next macrotask. Pipe validation errors
            // propagate through microtasks (which complete before macrotasks),
            // so if the lifecycle errored, `settled` is already true and we
            // skip the write. Otherwise headers are sent immediately rather
            // than waiting for the first Observable emission.
            setTimeout(() => {
                if (!settled) {
                    stream.commitHeaders();
                }
            }, 0);
            request.on('close', onClose);
        });
    }
    assertObservable(value) {
        if (!(0, rxjs_1.isObservable)(value)) {
            throw new ReferenceError('You must return an Observable stream to use Server-Sent Events (SSE).');
        }
    }
}
exports.RouterResponseController = RouterResponseController;
