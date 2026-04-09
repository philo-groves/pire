#ifndef PARITY_WEAVE_TYPES_H
#define PARITY_WEAVE_TYPES_H

#include <stddef.h>
#include <stdint.h>

#define WEAVE_MAX_ROWS 8

typedef struct WeaveThread {
	char name[16];
	uint32_t left;
	uint32_t right;
} WeaveThread;

typedef struct WeaveMask {
	char name[16];
	uint32_t left;
	uint32_t right;
} WeaveMask;

typedef struct WeaveStep {
	char name[16];
	char op[8];
	uint32_t adjust;
} WeaveStep;

typedef struct WeaveBundle {
	char mode[16];
	char phase[16];
	uint32_t span;
	uint32_t response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[24];
	WeaveThread threads[WEAVE_MAX_ROWS];
	WeaveMask masks[WEAVE_MAX_ROWS];
	WeaveStep steps[WEAVE_MAX_ROWS];
	size_t thread_count;
	size_t mask_count;
	size_t step_count;
} WeaveBundle;

char *weave_trim_line(char *line);
uint32_t weave_rol32(uint32_t value, unsigned int shift);
uint32_t weave_hash_token(const char *token);
void weave_decode_secret_token(char *output, size_t output_size);
int weave_ensure_dir(const char *path);
int weave_append_log_line(const char *runtime_dir, const char *line);
int weave_write_flag(const char *runtime_dir);
int weave_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int weave_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int weave_load_auth(const char *bundle_dir, WeaveBundle *bundle);
int weave_parse_bundle(const char *bundle_dir, WeaveBundle *bundle);
int weave_apply_policy(const char *runtime_dir, WeaveBundle *bundle, const char *secret_token);

#endif
