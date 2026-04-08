#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_SLOTS 8

typedef struct RotateContext {
	char slot_paths[MAX_SLOTS][32];
	char rotation_mode[16];
	char supplied_token[16];
	char supplied_receipt[32];
	int slot_count;
	int inspect;
} RotateContext;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'r' ^ 0x35, 'o' ^ 0x35, 't' ^ 0x35, '-' ^ 0x35, 't' ^ 0x35, 'o' ^ 0x35,
	'k' ^ 0x35, 'e' ^ 0x35, 'n' ^ 0x35, '-' ^ 0x35, '5' ^ 0x35, '5' ^ 0x35,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x35);
	}
	output[index] = '\0';
}

static int ensure_dir(const char *path) {
	if (mkdir(path, 0755) == 0 || errno == EEXIST) {
		return 0;
	}
	perror(path);
	return -1;
}

static int append_log_line(const char *runtime_dir, const char *line) {
	char path[PATH_MAX];
	FILE *log_file = NULL;
	snprintf(path, sizeof(path), "%s/logs/rotate.log", runtime_dir);
	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{log-rotate-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x5577UL);
	snprintf(path, sizeof(path), "%s/logs/rotate.receipt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

static int load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/logs/rotate.receipt", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(receipt);
	return 0;
}

/* copy_note uses bounded snprintf — not exploitable */
static void copy_note(char *dst, size_t dst_size, const char *src) {
	snprintf(dst, dst_size, "%s", src);
}

static int assign_slot(RotateContext *ctx, int slot_index, const char *path) {
	if (slot_index <= MAX_SLOTS) {
		snprintf(ctx->slot_paths[slot_index], 32, "%s", path);
		if (slot_index >= ctx->slot_count) {
			ctx->slot_count = slot_index + 1;
		}
		return 0;
	}
	return -1;
}

static int load_config(const char *config_dir, RotateContext *ctx) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	char note[64];
	int slot_index = 0;
	char slot_path[64];
	memset(ctx, 0, sizeof(*ctx));
	memset(note, 0, sizeof(note));
	snprintf(ctx->rotation_mode, sizeof(ctx->rotation_mode), "%s", "user_rotate");
	snprintf(path, sizeof(path), "%s/rotation.conf", config_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	slot_path[0] = '\0';
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(line, "slot") == 0) {
			slot_index = atoi(value);
		} else if (strcmp(line, "path") == 0) {
			snprintf(slot_path, sizeof(slot_path), "%s", value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(ctx->supplied_token, sizeof(ctx->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(ctx->supplied_receipt, sizeof(ctx->supplied_receipt), "%s", value);
		} else if (strcmp(line, "inspect") == 0) {
			ctx->inspect = atoi(value) != 0;
		} else if (strcmp(line, "note") == 0) {
			copy_note(note, sizeof(note), value);
		}
	}
	fclose(file);
	if (slot_path[0] != '\0') {
		assign_slot(ctx, slot_index, slot_path);
	}
	return 0;
}

int main(int argc, char **argv) {
	const char *config_dir = NULL;
	const char *runtime_dir = "./runtime";
	RotateContext ctx;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--config") == 0 && index + 1 < argc) {
			config_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (config_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/logs", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_config(config_dir, &ctx) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[rotate] loaded config");
	snprintf(line, sizeof(line), "[rotate] slots=%d", ctx.slot_count);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[rotate] mode=%s", ctx.rotation_mode);
	append_log_line(runtime_dir, line);
	if (ctx.inspect) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[rotate] inspect token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[rotate] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(ctx.rotation_mode, "root_rotate") == 0 &&
		strcmp(ctx.supplied_token, secret_token) == 0 &&
		strcmp(ctx.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_rotate created proof artifact");
		printf("root rotation completed successfully\n");
		return 0;
	}
	if (strcmp(ctx.rotation_mode, "root_rotate") == 0) {
		append_log_line(runtime_dir, "[rotate] root_rotate rejected: missing token or proof receipt");
	} else {
		append_log_line(runtime_dir, "[rotate] rotation completed without privileged action");
	}
	printf("rotation completed without privileged action\n");
	return 0;
}
