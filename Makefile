.PHONY: init update index status clean release

init:
	GIT_LFS_SKIP_SMUDGE=1 git submodule update --init --recursive

update:
	GIT_LFS_SKIP_SMUDGE=1 git submodule update --remote --recursive

index:
	qmd update
	qmd embed --chunk-strategy auto

status:
	qmd status

clean:
	rm -f .qmd/index.sqlite .qmd/index.sqlite-shm .qmd/index.sqlite-wal

release:
	sqlite3 .qmd/index.sqlite 'PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'
	mkdir -p dist
	gzip -c .qmd/index.sqlite > dist/filoscope.sqlite.gz
