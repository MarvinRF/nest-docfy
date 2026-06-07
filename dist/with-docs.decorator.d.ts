export declare const DOCFY_MARKER = "docfy:with_docs";
/**
 * Marks a NestJS controller so that DocfyModule will load its companion
 * docs file (*.controller.docs.ts / *.controller.docs.js) at startup.
 *
 * @example
 * @WithDocs()
 * @Controller('users')
 * export class UsersController { ... }
 */
export declare function WithDocs(): ClassDecorator;
