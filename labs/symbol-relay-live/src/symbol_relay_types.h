#ifndef SYMBOL_RELAY_TYPES_H
#define SYMBOL_RELAY_TYPES_H

#include <stddef.h>
#include <stdint.h>

#define RELAY_MAX_SYMBOLS 8
#define RELAY_MAX_STEPS 8

typedef struct RelaySymbol {
	char alias[16];
	uint32_t value;
	char class_name[16];
} RelaySymbol;

typedef struct RelayStep {
	char alias[16];
	char op[8];
	uint32_t adjust;
} RelayStep;

typedef struct RelayBundle {
	char mode[16];
	uint32_t window;
	uint32_t salt;
	uint32_t response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[24];
	RelaySymbol symbols[RELAY_MAX_SYMBOLS];
	RelayStep steps[RELAY_MAX_STEPS];
	size_t symbol_count;
	size_t step_count;
} RelayBundle;

char *relay_trim_line(char *line);
uint32_t relay_rol32(uint32_t value, unsigned int shift);
uint32_t relay_hash_token(const char *token);
void relay_decode_secret_token(char *output, size_t output_size);
int relay_ensure_dir(const char *path);
int relay_append_log_line(const char *runtime_dir, const char *line);
int relay_write_flag(const char *runtime_dir);
int relay_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int relay_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int relay_load_auth(const char *bundle_dir, RelayBundle *bundle);
int relay_parse_bundle(const char *bundle_dir, RelayBundle *bundle);
int relay_apply_policy(const char *runtime_dir, RelayBundle *bundle, const char *secret_token);

#endif
