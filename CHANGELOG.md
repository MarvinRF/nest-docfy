# [0.13.0](https://github.com/MarvinRF/nest-docfy/compare/v0.12.0...v0.13.0) (2026-07-31)


### Bug Fixes

* force-close keep-alive sockets in mock/contract-test helpers ([d8a38d2](https://github.com/MarvinRF/nest-docfy/commit/d8a38d26b885d791e1b9ac7232e7e0f4d4306135))


### Features

* **cli:** add --overwrite to generate and version-drift warning to check ([e631455](https://github.com/MarvinRF/nest-docfy/commit/e6314559e0c1aa7291ecf5978301c3093080620b))

# [0.12.0](https://github.com/MarvinRF/nest-docfy/compare/v0.11.0...v0.12.0) (2026-07-31)


### Features

* add lint-spec CLI command and guides option to DocfyUiModule ([b91e012](https://github.com/MarvinRF/nest-docfy/commit/b91e0129f777792a4030f731b9697b25ed99c9eb))

# [0.11.0](https://github.com/MarvinRF/nest-docfy/compare/v0.10.0...v0.11.0) (2026-07-31)


### Features

* **cli:** add `mock` command — throwaway HTTP server from an OpenAPI doc ([c5ea612](https://github.com/MarvinRF/nest-docfy/commit/c5ea612388ab85f9d88ba97a40d75189ef8c0445))
* **cli:** add `test` command — contract testing straight off the spec ([71f2e75](https://github.com/MarvinRF/nest-docfy/commit/71f2e7553c4f46afd9860684974cdc6ea8fbe796))
* serve llms.txt/llms-full.txt from DocfyUiModule.setup() ([30375d9](https://github.com/MarvinRF/nest-docfy/commit/30375d9da5b44fb5980e6c3e4dd19dfc472fffc8))

# [0.10.0](https://github.com/MarvinRF/nest-docfy/compare/v0.9.1...v0.10.0) (2026-07-30)


### Bug Fixes

* **cli:** load generate-client's openapi-typescript import lazily ([06b8d2b](https://github.com/MarvinRF/nest-docfy/commit/06b8d2b1dcb2aa8373c156fa30c7a30bd6dd99e7))
* downgrade commander to ^14.0.3 (v15 dropped CJS support) ([3ec9194](https://github.com/MarvinRF/nest-docfy/commit/3ec9194d0643249c70b85165c057abcdff320d9f))
* exclude CHANGELOG.md from prettier ([3d75819](https://github.com/MarvinRF/nest-docfy/commit/3d75819dc637f031c6d0fb6c5b02fb33ddd99209))
* prettier formatting drift in export command (cli/index.ts, export-entry-runner.ts) ([37c2af0](https://github.com/MarvinRF/nest-docfy/commit/37c2af0712d3f14fee70d27e02cca9fa60344dcc))
* **test:** isolate e2e.spec.ts fixtures to fix flaky/failing CI ([3190e02](https://github.com/MarvinRF/nest-docfy/commit/3190e025d7879c64d3dc95ca24371a927e134b30))


### Features

* **ci:** add docfy-pr-check-reusable.yml for external consumers ([04ef645](https://github.com/MarvinRF/nest-docfy/commit/04ef645c65092cbaa46e63ce4df5b977cfdd3dfe))
* **ci:** add spec-diff script for breaking-change detection ([e4ee847](https://github.com/MarvinRF/nest-docfy/commit/e4ee847217be7c4a1f4d0b4d490b747c9a9006b0))
* **ci:** surface breaking-change spec diff in the PR comment ([94259da](https://github.com/MarvinRF/nest-docfy/commit/94259da0a778a833be7e2f5259533f4b632524e3))
* **examples:** add docfy-export.ts entry file to basic-nest-app ([cbd113c](https://github.com/MarvinRF/nest-docfy/commit/cbd113c9edc30f60cfb21170bfb2c727c1ac3865))

## [0.9.1](https://github.com/MarvinRF/nest-docfy/compare/v0.9.0...v0.9.1) (2026-07-30)


### Bug Fixes

* **cli:** warn when docfy-ui is declared in the app's own package.json ([7c9aea8](https://github.com/MarvinRF/nest-docfy/commit/7c9aea8105420c5a064adda4580cc0c29fac0404))

# [0.9.0](https://github.com/MarvinRF/nest-docfy/compare/v0.8.0...v0.9.0) (2026-07-29)


### Documentation

* document specs/openApiDocument/additionalProxyOrigins in DocfyUiModule.setup(), and bump the pinned docfy-ui dependency to ^0.5.0 ([f47fe8d](https://github.com/MarvinRF/nest-docfy/commit/f47fe8d42a4dd805d89aca0e10ee510a77cfde90))

# [0.8.0](https://github.com/MarvinRF/nest-docfy/compare/v0.7.0...v0.8.0) (2026-07-29)


### Features

* add a same-origin proxy for docfy-ui's "Try it out" (avoids CORS) ([988791e](https://github.com/MarvinRF/nest-docfy/commit/988791ea37db3bb95786c585b7393647a3b1b787))

# [0.7.0](https://github.com/MarvinRF/nest-docfy/compare/v0.6.3...v0.7.0) (2026-07-29)


### Features

* **cli:** add export command — generate the OpenAPI document without .listen() ([cc666f0](https://github.com/MarvinRF/nest-docfy/commit/cc666f0101c70c4b1010621246127b07cb7ad5aa))

## [0.6.3](https://github.com/MarvinRF/nest-docfy/compare/v0.6.2...v0.6.3) (2026-07-29)


### Bug Fixes

* collapse boolean literal unions to a plain boolean schema ([e9aa6a2](https://github.com/MarvinRF/nest-docfy/commit/e9aa6a281ffa31b0a33f3ad64c73b222e14b6a7d))

## [0.6.2](https://github.com/MarvinRF/nest-docfy/compare/v0.6.1...v0.6.2) (2026-07-29)


### Bug Fixes

* bump pinned docfy-ui dependency to ^0.3.0 ([ad2c188](https://github.com/MarvinRF/nest-docfy/commit/ad2c188595250503c0dfed18075469a71794bbcd))

## [0.6.1](https://github.com/MarvinRF/nest-docfy/compare/v0.6.0...v0.6.1) (2026-07-29)


### Bug Fixes

* infer full schema for response entities without class-validator decorators ([ad7a59d](https://github.com/MarvinRF/nest-docfy/commit/ad7a59d00ddc3c8d3e20df2f99cdd6aac2be03c0))

# [0.6.0](https://github.com/MarvinRF/nest-docfy/compare/v0.5.0...v0.6.0) (2026-07-26)


### Bug Fixes

* widen docfy-ui dependency range to include the 0.1.0 release ([843d0d9](https://github.com/MarvinRF/nest-docfy/commit/843d0d99468d5182f3b6cbf36d8325eabc8cef20))


### Features

* **ci:** PR-check bot — dogfoods check/coverage against the example app ([83277e6](https://github.com/MarvinRF/nest-docfy/commit/83277e617e7a1759fcbb3c5a40e9cad2605802b0))
* **cli:** --json flag for check and coverage ([cfd503d](https://github.com/MarvinRF/nest-docfy/commit/cfd503d34283dcf03eb15c671f2185b59e63e743))
* **docfy-ui-module:** add specs option for docfy-ui's multi-spec switcher ([01a884f](https://github.com/MarvinRF/nest-docfy/commit/01a884f89ea0226a8ce72dec8e3587a6ccc7fb79))
* **generate:** --register-plugin auto-fixes webpack:true without the CLI plugin ([06362f7](https://github.com/MarvinRF/nest-docfy/commit/06362f74660cc992e969e39d9c64b5d98230b764))
* generate-client command — typed TS client from an OpenAPI spec ([d8e21c7](https://github.com/MarvinRF/nest-docfy/commit/d8e21c77c13b8f9dfeefe582bbff90bd803943cd))
* **generate:** warn when webpack:true is set without the CLI plugin ([2f62327](https://github.com/MarvinRF/nest-docfy/commit/2f62327301f116f3264b5f96be281a396e9ac0b7))
* **readme:** add --json option to CLI commands for machine-readable output ([5e8e952](https://github.com/MarvinRF/nest-docfy/commit/5e8e952f370717dee1c5d6069ca8e26aaca14222))

# 0.5.0 (2026-07-25)


### Bug Fixes

* add default export condition to package.json exports map ([e99853e](https://github.com/MarvinRF/nest-docfy/commit/e99853e5fd638b6e446df41aa5a6c0f09c039a42)), closes [#1](https://github.com/MarvinRF/nest-docfy/issues/1)
* cleanup pass — three correctness and clarity issues ([7970d1c](https://github.com/MarvinRF/nest-docfy/commit/7970d1c2c649bba154fb364aa9417927e6a51c77))
* findFileInCache crashed when a require.cache entry's exports had a throwing getter (e.g. express's request.js req.query) ([8c93ee5](https://github.com/MarvinRF/nest-docfy/commit/8c93ee56e93c1c49253d3ce0462d0d93f6db7308))
* four correctness bugs in patch-spec/applyDocfyMetadata, found by building a real demo app ([cdf41c7](https://github.com/MarvinRF/nest-docfy/commit/cdf41c7cce8ccf2e03f68d93dadc9c84a57d1652))
* generate ready-to-use decorators instead of commented placeholders ([541e732](https://github.com/MarvinRF/nest-docfy/commit/541e7321a1ec8f57036fef3f1584727357023f51))
* isMissingDocsFile false-positives when docsPath appears only in the Require-stack trailer ([86b3ea2](https://github.com/MarvinRF/nest-docfy/commit/86b3ea2ca1a3cf2a70de6a8fbd39eb18ccd75b29))
* mergeTags treated differing-case tags as distinct, splitting the sidebar group ([44d8547](https://github.com/MarvinRF/nest-docfy/commit/44d8547ec81366f77edfafb2778a9f66794d7cb5))
* patch-spec lost fields when two controllers patched the same route ([8c81a8f](https://github.com/MarvinRF/nest-docfy/commit/8c81a8f2c7fdd3b0082955763a97ca71a95ef712))
* resolve controller source file via stack+source-map when require.cache has no per-file entry ([5f5b0d0](https://github.com/MarvinRF/nest-docfy/commit/5f5b0d005f75efb75ade6cc0adbcffe87d95a732))
* update version to 0.3.1 in package-lock.json ([366e228](https://github.com/MarvinRF/nest-docfy/commit/366e2288c164495ca15c721e748f9629b1215633))
* update version to 0.3.2 in package.json ([d76099f](https://github.com/MarvinRF/nest-docfy/commit/d76099f5a7d7def47b3f7ee5bb54d3f7b898ea8a))
* update version to 0.3.4 and docfy-ui dependency to 0.0.4 ([4fd1710](https://github.com/MarvinRF/nest-docfy/commit/4fd1710134c3eabd293654509153c0062105409b))
* update version to 0.3.5 and docfy-ui dependency to 0.0.5; enhance routing support in DocfyUiModule ([9d03e94](https://github.com/MarvinRF/nest-docfy/commit/9d03e943ca476afa8d46ae759b4c96986c40f2cb))


### Features

* add check command, @HttpCode() awareness, and class-validator schema inference ([f9c8f9f](https://github.com/MarvinRF/nest-docfy/commit/f9c8f9f8311875d875216c5039946e08bab0cc7a))
* add coverage command for documentation metrics ([a289ba6](https://github.com/MarvinRF/nest-docfy/commit/a289ba65ff9a335e2853471dc2fe995222df88b8))
* add Fastify support to DocfyUiModule ([2423cbe](https://github.com/MarvinRF/nest-docfy/commit/2423cbe163ca4407ad9ff4673faa94d3dee83925))
* add lint command for documentation quality checks ([e8a231a](https://github.com/MarvinRF/nest-docfy/commit/e8a231ac1dc0ed14ae3e27d59ea35c664a8eca4a))
* add nestjs-docfy generate CLI ([ddc7be3](https://github.com/MarvinRF/nest-docfy/commit/ddc7be309663bd1575bcf32afb4b35bfc2b261b7))
* add nestjs-docfy/plugin — CLI compiler plugin for webpack: true builds ([6932f58](https://github.com/MarvinRF/nest-docfy/commit/6932f58fe0df45e532ec86478dd6ce5c398e5dfc))
* add tag groups (x-tagGroups) for ReDoc ([ff9c434](https://github.com/MarvinRF/nest-docfy/commit/ff9c43415cf5759a4542b49c5ffb41232707f518))
* **cli:** add DTO response type inference to ApiResponse output ([afe4806](https://github.com/MarvinRF/nest-docfy/commit/afe48062f0231ab18e907f5fa38e8c569c1bbcf2))
* **cli:** complete output — ApiParam/Body/Query, inferred summaries, ApiBearerAuth, watch mode ([3f4a268](https://github.com/MarvinRF/nest-docfy/commit/3f4a268106605b1bfcd8af5cdc1b47953e3a7008))
* **cli:** generate inline schema for interface-typed DTOs ([ea5efa5](https://github.com/MarvinRF/nest-docfy/commit/ea5efa52f7e4e18a4f68874726cb8f090dc67ff3))
* **cli:** richer ApiResponse output with descriptions and error responses ([e626a2d](https://github.com/MarvinRF/nest-docfy/commit/e626a2ddbe9b9da4ddbe1535e3534d4bbc53e385))
* DocfyUiModule — serve docfy-ui by default, with a webpack-safe static-spec mode ([cb44a8d](https://github.com/MarvinRF/nest-docfy/commit/cb44a8d4041c3fc22935f99a8022a93303aa389a))
* initial implementation of nestjs-docfy ([5ab5078](https://github.com/MarvinRF/nest-docfy/commit/5ab507814dbf91656caf2f87d9b6fe1f5b2022e4))
* patch-spec CLI command — static-analysis-only OpenAPI patching ([6ecbbba](https://github.com/MarvinRF/nest-docfy/commit/6ecbbba42d3ef1fa4b11661f68197857f90787b3))
* **patch-spec:** support enum, union types (oneOf), and example/examples ([5b705be](https://github.com/MarvinRF/nest-docfy/commit/5b705beeed5b5a3fc98326ed6d52fec1d02a9a65))
* resolve enum references imported from another file ([6fea047](https://github.com/MarvinRF/nest-docfy/commit/6fea047405ca73d76a2c4f699f19663275907caf))
* type-safe method keys in docs() via generics ([2119852](https://github.com/MarvinRF/nest-docfy/commit/2119852521a4e7fb5f7e708945a88e545aaca949))
