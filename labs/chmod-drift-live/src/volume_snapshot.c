#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct VolumeState {
	unsigned int owner_mode;
	unsigned int mount_mode;
	unsigned int effective_mode;
	char write_level[16];
	char supplied_token[16];
	char supplied_receipt[32];
	int debug;
} VolumeState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'c' ^ 0x2d, 'h' ^ 0x2d, 'm' ^ 0x2d, 'd' ^ 0x2d, '-' ^ 0x2d, 't' ^ 0x2d,
	'o' ^ 0x2d, 'k' ^ 0x2d, 'e' ^ 0x2d, 'n' ^ 0x2d, '-' ^ 0x2d, '6' ^ 0x2d,
	'7' ^ 0x2d,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x2d);
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
	snprintf(path, sizeof(path), "%s/volume/volume.log", runtime_dir);
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
	fprintf(file, "FLAG{chmod-drift-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x6767UL);
	snprintf(path, sizeof(path), "%s/volume/volume.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/volume/volume.receipt", runtime_dir);
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

static int load_volume(const char *volume_dir, VolumeState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	state->owner_mode = 0600;
	state->mount_mode = 0600;
	snprintf(path, sizeof(path), "%s/volume.conf", volume_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(line, "owner_mode") == 0) {
			state->owner_mode = (unsigned int)strtoul(value, NULL, 8);
		} else if (strcmp(line, "mount_mode") == 0) {
			state->mount_mode = (unsigned int)strtoul(value, NULL, 8);
		} else if (strcmp(line, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		} else if (strcmp(line, "debug") == 0) {
			state->debug = atoi(value) != 0;
		}
	}
	fclose(file);
	return 0;
}

/*
 * Compute the effective permission mode for the mounted volume.
 * Combines owner-declared mode with mount-enforced mode.
 * The effective mode should restrict access to the intersection
 * of both policies.
 */
static void compute_effective_mode(VolumeState *state) {
	state->effective_mode = state->owner_mode | state->mount_mode;
	if (state->effective_mode & 002) {
		snprintf(state->write_level, sizeof(state->write_level), "%s", "world_write");
	} else {
		snprintf(state->write_level, sizeof(state->write_level), "%s", "restricted");
	}
}

int main(int argc, char **argv) {
	const char *volume_dir = NULL;
	const char *runtime_dir = "./runtime";
	VolumeState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--volume") == 0 && index + 1 < argc) {
			volume_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (volume_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/volume", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_volume(volume_dir, &state) != 0) {
		return 1;
	}
	compute_effective_mode(&state);
	append_log_line(runtime_dir, "[volume] loaded config");
	snprintf(line, sizeof(line), "[volume] owner=%04o mount=%04o effective=%04o",
		state.owner_mode, state.mount_mode, state.effective_mode);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[volume] write_level=%s", state.write_level);
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[volume] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[volume] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.write_level, "world_write") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] world_write volume — proof created");
		printf("volume write escalation completed successfully\n");
		return 0;
	}
	if (strcmp(state.write_level, "world_write") == 0) {
		append_log_line(runtime_dir, "[volume] world_write rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[volume] volume completed without write escalation");
	}
	printf("volume completed without write escalation\n");
	return 0;
}
