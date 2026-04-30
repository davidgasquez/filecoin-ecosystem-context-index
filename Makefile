.PHONY: build publish deploy docker run

build:
	./scripts/build-index

publish:
	./scripts/publish-dataset

deploy:
	./scripts/deploy-space

docker:
	docker build -t filecoin-docs-qmd-mcp .

run:
	docker run --rm -p 7860:7860 filecoin-docs-qmd-mcp
