#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct UpdateContext {
	char package_name[32];
	char action_name[16];
	char supplied_token[16];
	char supplied_receipt[32];
	char note[64];
} UpdateContext;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'u' ^ 0x31, 'p' ^ 0x31, 'd' ^ 0x31, '-' ^ 0x31, 't' ^ 0x31, 'o' ^ 0x31,
	'k' ^ 0x31, 'e' ^ 0x31, 'n' ^ 0x31, '-' ^ 0x31, '3' ^ 0x31, '3' ^ 0x31,
};

static char *trim_line(char *line);

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x31);
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
	snprintf(path, sizeof(path), "%s/logs/updater.log", runtime_dir);
	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_root_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *flag_file = NULL;
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	flag_file = fopen(path, "w");
	if (flag_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(flag_file, "FLAG{updater-live}\n");
	fclose(flag_file);
	return 0;
}

static int receipt_path(char *path, size_t path_size, const char *runtime_dir) {
	return snprintf(path, path_size, "%s/logs/updater.receipt", runtime_dir) >= (int)path_size ? -1 : 0;
}

static int write_disclosure_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x3344UL);
	if (receipt_path(path, sizeof(path), runtime_dir) != 0) {
		return -1;
	}
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

static int load_disclosure_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	if (receipt_path(path, sizeof(path), runtime_dir) != 0) {
		return -1;
	}
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

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static void unsafe_copy(char *dst, const char *src) {
	size_t index = 0;
	while (src[index] != '\0') {
		dst[index] = src[index];
		index++;
	}
	dst[index] = '\0';
}

static int load_manifest(const char *bundle_dir, UpdateContext *ctx, int *trace) {
	char path[PATH_MAX];
	FILE *manifest = NULL;
	char line[256];
	memset(ctx, 0, sizeof(*ctx));
	snprintf(ctx->action_name, sizeof(ctx->action_name), "%s", "staging_apply");
	snprintf(path, sizeof(path), "%s/manifest.ini", bundle_dir);
	manifest = fopen(path, "r");
	if (manifest == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), manifest) != NULL) {
		char *value = NULL;
		trim_line(line);
		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(line, "package") == 0) {
			unsafe_copy(ctx->package_name, value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(ctx->supplied_token, sizeof(ctx->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(ctx->supplied_receipt, sizeof(ctx->supplied_receipt), "%s", value);
		} else if (strcmp(line, "trace") == 0) {
			*trace = atoi(value) != 0;
		} else if (strcmp(line, "note") == 0) {
			snprintf(ctx->note, sizeof(ctx->note), "%s", value);
		}
	}
	fclose(manifest);
	return 0;
}

int main(int argc, char **argv) {
	const char *bundle_dir = NULL;
	const char *runtime_dir = "./runtime";
	UpdateContext ctx;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int trace = 0;
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--bundle") == 0 && index + 1 < argc) {
			bundle_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (bundle_dir == NULL) {
		return 2;
	}
	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/logs", runtime_dir);
	ensure_dir(line);
	if (load_manifest(bundle_dir, &ctx, &trace) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[updater] loaded manifest");
	snprintf(line, sizeof(line), "[updater] package=%s", ctx.package_name);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[updater] action=%s", ctx.action_name);
	append_log_line(runtime_dir, line);
	if (trace) {
		if (write_disclosure_receipt(runtime_dir, receipt, sizeof(receipt)) != 0) {
			return 1;
		}
		snprintf(line, sizeof(line), "[updater] trace token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[updater] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_disclosure_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(ctx.action_name, "root_apply") == 0 && strcmp(ctx.supplied_token, secret_token) == 0 &&
		strcmp(ctx.supplied_receipt, receipt) == 0) {
		write_root_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_apply created proof artifact");
		printf("root apply completed successfully\n");
		return 0;
	}
	if (strcmp(ctx.action_name, "root_apply") == 0) {
		append_log_line(runtime_dir, "[updater] root_apply rejected: missing token or proof receipt");
	} else {
		append_log_line(runtime_dir, "[updater] staging apply completed without privileged action");
	}
	printf("updater completed without privileged action\n");
	return 0;
}
