#ifndef LEDGER_LOCK_TYPES_H
#define LEDGER_LOCK_TYPES_H

#include <stddef.h>
#include <stdint.h>

#define LEDGER_MAX_ROWS 8

typedef struct LedgerAccount {
	char name[16];
	uint32_t value;
	uint32_t tag;
} LedgerAccount;

typedef struct LedgerLink {
	char from[16];
	char to[16];
	uint32_t weight;
} LedgerLink;

typedef struct LedgerStep {
	char name[16];
	char op[8];
	uint32_t adjust;
} LedgerStep;

typedef struct LedgerBundle {
	char mode[16];
	char phase[16];
	uint32_t window;
	uint32_t response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[24];
	LedgerAccount accounts[LEDGER_MAX_ROWS];
	LedgerLink links[LEDGER_MAX_ROWS];
	LedgerStep steps[LEDGER_MAX_ROWS];
	size_t account_count;
	size_t link_count;
	size_t step_count;
} LedgerBundle;

char *ledger_trim_line(char *line);
uint32_t ledger_rol32(uint32_t value, unsigned int shift);
uint32_t ledger_hash_token(const char *token);
void ledger_decode_secret_token(char *output, size_t output_size);
int ledger_ensure_dir(const char *path);
int ledger_append_log_line(const char *runtime_dir, const char *line);
int ledger_write_flag(const char *runtime_dir);
int ledger_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int ledger_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int ledger_load_auth(const char *bundle_dir, LedgerBundle *bundle);
int ledger_parse_bundle(const char *bundle_dir, LedgerBundle *bundle);
int ledger_apply_policy(const char *runtime_dir, LedgerBundle *bundle, const char *secret_token);

#endif
