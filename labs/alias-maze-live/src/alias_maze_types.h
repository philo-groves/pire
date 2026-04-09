#ifndef ALIAS_MAZE_TYPES_H
#define ALIAS_MAZE_TYPES_H

#include <stddef.h>
#include <stdint.h>

#define MAZE_MAX_BASES 8
#define MAZE_MAX_ALIASES 16
#define MAZE_MAX_STEPS 8

typedef struct MazeBase {
	char name[16];
	uint32_t value;
	uint32_t class_tag;
} MazeBase;

typedef struct MazeAlias {
	char alias[16];
	char target[16];
} MazeAlias;

typedef struct MazeStep {
	char alias[16];
	char op[8];
	uint32_t adjust;
} MazeStep;

typedef struct MazeBundle {
	char mode[16];
	uint32_t window;
	uint32_t response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[24];
	MazeBase bases[MAZE_MAX_BASES];
	MazeAlias aliases[MAZE_MAX_ALIASES];
	MazeStep steps[MAZE_MAX_STEPS];
	size_t base_count;
	size_t alias_count;
	size_t step_count;
} MazeBundle;

char *maze_trim_line(char *line);
uint32_t maze_rol32(uint32_t value, unsigned int shift);
uint32_t maze_hash_token(const char *token);
void maze_decode_secret_token(char *output, size_t output_size);
int maze_ensure_dir(const char *path);
int maze_append_log_line(const char *runtime_dir, const char *line);
int maze_write_flag(const char *runtime_dir);
int maze_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int maze_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size);
int maze_load_auth(const char *bundle_dir, MazeBundle *bundle);
int maze_parse_bundle(const char *bundle_dir, MazeBundle *bundle);
int maze_apply_policy(const char *runtime_dir, MazeBundle *bundle, const char *secret_token);

#endif
