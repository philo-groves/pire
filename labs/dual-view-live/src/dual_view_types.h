#ifndef DUAL_VIEW_TYPES_H
#define DUAL_VIEW_TYPES_H

#include <stddef.h>
#include <stdint.h>

#define DUAL_MAX_ROWS 8

typedef struct DualRow {
	char name[16];
	uint32_t left;
	uint32_t right;
} DualRow;

typedef struct DualBundle {
	char mode[16];
	char profile[16];
	uint32_t width;
	uint32_t response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[24];
	DualRow primary[DUAL_MAX_ROWS];
	DualRow shadow[DUAL_MAX_ROWS];
	size_t primary_count;
	size_t shadow_count;
} DualBundle;

char *dual_trim_line(char *line);
uint32_t dual_rol32(uint32_t value, unsigned int shift);
uint32_t dual_hash_token(const char *token);
void dual_decode_secret_token(char *output, size_t output_size);
int dual_ensure_dir(const char *path);
int dual_append_log_line(const char *runtime_dir, const char *line);
int dual_write_flag(const char *runtime_dir);
int dual_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int dual_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int dual_load_auth(const char *bundle_dir, DualBundle *bundle);
int dual_parse_bundle(const char *bundle_dir, DualBundle *bundle);
int dual_apply_policy(const char *runtime_dir, DualBundle *bundle, const char *secret_token);

#endif
