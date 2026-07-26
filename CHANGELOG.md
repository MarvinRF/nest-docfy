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
