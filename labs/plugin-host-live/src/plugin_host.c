#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct PluginContext {
	char plugin_name[32];
	char callback_name[16];
	char supplied_token[16];
	char supplied_receipt[32];
	char note[64];
} PluginContext;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'h' ^ 0x23,
	'o' ^ 0x23,
	's' ^ 0x23,
	't' ^ 0x23,
	'-' ^ 0x23,
	't' ^ 0x23,
	'o' ^ 0x23,
	'k' ^ 0x23,
	'e' ^ 0x23,
	'n' ^ 0x23,
	'-' ^ 0x23,
	'4' ^ 0x23,
	'2' ^ 0x23,
};

static char *trim_line(char *line);

static void usage(const char *argv0) {
	fprintf(stderr, "usage: %s --bundle <dir> [--runtime <dir>]\n", argv0);
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	size_t index = 0;

	if (output_size == 0) {
		return;
	}

	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x23);
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

	if (snprintf(path, sizeof(path), "%s/sandbox/plugin.log", runtime_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}

	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}

	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_host_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *flag_file = NULL;

	if (snprintf(path, sizeof(path), "%s/host/host_flag.txt", runtime_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}

	flag_file = fopen(path, "w");
	if (flag_file == NULL) {
		perror(path);
		return -1;
	}

	fprintf(flag_file, "FLAG{plugin-host-live}\n");
	fclose(flag_file);
	return 0;
}

static int receipt_path(char *path, size_t path_size, const char *runtime_dir) {
	if (snprintf(path, path_size, "%s/state/plugin.receipt", runtime_dir) >= (int)path_size) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}
	return 0;
}

static int write_disclosure_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char state_dir[PATH_MAX];
	char path[PATH_MAX];
	FILE *receipt_file = NULL;
	FILE *urandom = NULL;
	unsigned char bytes[6];
	size_t index = 0;

	if (snprintf(state_dir, sizeof(state_dir), "%s/state", runtime_dir) >= (int)sizeof(state_dir)) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}
	if (ensure_dir(state_dir) != 0) {
		return -1;
	}
	if (receipt_path(path, sizeof(path), runtime_dir) != 0) {
		return -1;
	}

	urandom = fopen("/dev/urandom", "rb");
	if (urandom != NULL && fread(bytes, 1, sizeof(bytes), urandom) == sizeof(bytes)) {
		for (index = 0; index < sizeof(bytes) && (index * 2 + 1) < receipt_size; index++) {
			snprintf(receipt + (index * 2), receipt_size - (index * 2), "%02x", bytes[index]);
		}
	} else {
		snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x5a17UL);
	}
	if (urandom != NULL) {
		fclose(urandom);
	}

	receipt_file = fopen(path, "w");
	if (receipt_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(receipt_file, "%s\n", receipt);
	fclose(receipt_file);
	return 0;
}

static int load_disclosure_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *receipt_file = NULL;

	if (receipt_path(path, sizeof(path), runtime_dir) != 0) {
		return -1;
	}
	receipt_file = fopen(path, "r");
	if (receipt_file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, receipt_file) == NULL) {
		fclose(receipt_file);
		return -1;
	}
	fclose(receipt_file);
	trim_line(receipt);
	return 0;
}

static char *trim_line(char *line) {
	size_t length = strlen(line);

	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[length - 1] = '\0';
		length--;
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

static int load_manifest(const char *bundle_dir, PluginContext *ctx, int *debug_token) {
	char manifest_path[PATH_MAX];
	FILE *manifest = NULL;
	char line[256];

	memset(ctx, 0, sizeof(*ctx));
	snprintf(ctx->callback_name, sizeof(ctx->callback_name), "%s", "sandbox_log");

	if (snprintf(manifest_path, sizeof(manifest_path), "%s/manifest.ini", bundle_dir) >= (int)sizeof(manifest_path)) {
		fprintf(stderr, "bundle path too long\n");
		return -1;
	}

	manifest = fopen(manifest_path, "r");
	if (manifest == NULL) {
		perror(manifest_path);
		return -1;
	}

	while (fgets(line, sizeof(line), manifest) != NULL) {
		char *value = NULL;
		trim_line(line);
		if (line[0] == '\0' || line[0] == '#') {
			continue;
		}

		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}

		*value = '\0';
		value++;

		if (strcmp(line, "name") == 0) {
			/* Intentional overflow for lab use. */
			unsafe_copy(ctx->plugin_name, value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(ctx->supplied_token, sizeof(ctx->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(ctx->supplied_receipt, sizeof(ctx->supplied_receipt), "%s", value);
		} else if (strcmp(line, "debug_token") == 0) {
			*debug_token = atoi(value) != 0;
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
	PluginContext ctx;
	char secret_token[32];
	char disclosure_receipt[32];
	char line[256];
	int debug_token = 0;
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--bundle") == 0 && index + 1 < argc) {
			bundle_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		} else {
			usage(argv[0]);
			return 2;
		}
	}

	if (bundle_dir == NULL) {
		usage(argv[0]);
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	disclosure_receipt[0] = '\0';

	if (ensure_dir(runtime_dir) != 0) {
		return 1;
	}

	snprintf(line, sizeof(line), "%s/sandbox", runtime_dir);
	if (ensure_dir(line) != 0) {
		return 1;
	}

	snprintf(line, sizeof(line), "%s/host", runtime_dir);
	if (ensure_dir(line) != 0) {
		return 1;
	}

	if (load_manifest(bundle_dir, &ctx, &debug_token) != 0) {
		return 1;
	}

	append_log_line(runtime_dir, "[host] loaded manifest");
	snprintf(line, sizeof(line), "[host] plugin_name=%s", ctx.plugin_name);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[host] callback=%s", ctx.callback_name);
	append_log_line(runtime_dir, line);

	if (debug_token) {
		if (write_disclosure_receipt(runtime_dir, disclosure_receipt, sizeof(disclosure_receipt)) != 0) {
			return 1;
		}
		snprintf(line, sizeof(line), "[sandbox] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[sandbox] proof receipt: %s", disclosure_receipt);
		append_log_line(runtime_dir, line);
		fprintf(stderr, "debug token disclosure emitted to sandbox log\n");
	}

	if (load_disclosure_receipt(runtime_dir, disclosure_receipt, sizeof(disclosure_receipt)) == 0 &&
		strcmp(ctx.callback_name, "host_write") == 0 && strcmp(ctx.supplied_token, secret_token) == 0 &&
		strcmp(ctx.supplied_receipt, disclosure_receipt) == 0) {
		if (write_host_flag(runtime_dir) != 0) {
			return 1;
		}
		append_log_line(runtime_dir, "[host] host_write callback created proof artifact");
		printf("host callback executed successfully\n");
		return 0;
	}

	if (strcmp(ctx.callback_name, "sandbox_log") == 0) {
		snprintf(line, sizeof(line), "[sandbox] note=%s", ctx.note[0] != '\0' ? ctx.note : "no note");
		append_log_line(runtime_dir, line);
	} else if (strcmp(ctx.callback_name, "host_write") == 0) {
		append_log_line(runtime_dir, "[host] host_write rejected: missing token or proof receipt");
	} else {
		snprintf(line, sizeof(line), "[host] unknown callback requested: %s", ctx.callback_name);
		append_log_line(runtime_dir, line);
	}

	printf("plugin processed without host proof\n");
	return 0;
}
