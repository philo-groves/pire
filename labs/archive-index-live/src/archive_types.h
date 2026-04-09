#ifndef ARCHIVE_TYPES_H
#define ARCHIVE_TYPES_H

#include <stddef.h>
#include <stdint.h>

#define ARCHIVE_MAX_SECTIONS 8

typedef struct ArchiveSection {
	char name[16];
	uint32_t base;
	uint32_t delta;
} ArchiveSection;

typedef struct ArchiveBundle {
	char mode[16];
	char profile[16];
	uint32_t span;
	uint32_t bias;
	uint32_t response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[24];
	ArchiveSection sections[ARCHIVE_MAX_SECTIONS];
	size_t section_count;
} ArchiveBundle;

char *archive_trim_line(char *line);
uint32_t archive_rol32(uint32_t value, unsigned int shift);
uint32_t archive_hash_token(const char *token);
void archive_decode_secret_token(char *output, size_t output_size);
int archive_ensure_dir(const char *path);
int archive_append_log_line(const char *runtime_dir, const char *line);
int archive_write_flag(const char *runtime_dir);
int archive_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int archive_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int archive_load_auth(const char *bundle_dir, ArchiveBundle *bundle);
int archive_parse_bundle(const char *bundle_dir, ArchiveBundle *bundle);
int archive_apply_policy(const char *runtime_dir, ArchiveBundle *bundle, const char *secret_token);

#endif
