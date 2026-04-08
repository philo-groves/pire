#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define MAX_PIXELS 4096

typedef struct ImageHeader {
	unsigned int width;
	unsigned int height;
	char channel[16];
	char decode_mode[16];
	char supplied_token[16];
	char supplied_receipt[32];
	int debug_header;
} ImageHeader;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'i' ^ 0x1f, 'm' ^ 0x1f, 'g' ^ 0x1f, '-' ^ 0x1f, 't' ^ 0x1f, 'o' ^ 0x1f,
	'k' ^ 0x1f, 'e' ^ 0x1f, 'n' ^ 0x1f, '-' ^ 0x1f, '8' ^ 0x1f, '8' ^ 0x1f,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x1f);
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
	snprintf(path, sizeof(path), "%s/decoder/decoder.log", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/decoder/decode_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{image-decoder-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x8888UL);
	snprintf(path, sizeof(path), "%s/decoder/decoder.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/decoder/decoder.receipt", runtime_dir);
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

/* normalize_channel lowercases into a bounded buffer — not exploitable */
static void normalize_channel(char *dst, size_t dst_size, const char *src) {
	size_t index = 0;
	while (src[index] != '\0' && index + 1 < dst_size) {
		char ch = src[index];
		if (ch >= 'A' && ch <= 'Z') {
			ch = (char)(ch + ('a' - 'A'));
		}
		dst[index] = ch;
		index++;
	}
	dst[index] = '\0';
}

static int validate_dimensions(unsigned int width, unsigned int height) {
	unsigned short total = (unsigned short)(width * height);
	if (total > MAX_PIXELS) {
		return -1;
	}
	return 0;
}

static int load_header(const char *header_dir, ImageHeader *hdr) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	char raw_channel[32];
	memset(hdr, 0, sizeof(*hdr));
	memset(raw_channel, 0, sizeof(raw_channel));
	snprintf(hdr->decode_mode, sizeof(hdr->decode_mode), "%s", "safe_rgb");
	snprintf(path, sizeof(path), "%s/header.conf", header_dir);
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
		if (strcmp(line, "width") == 0) {
			hdr->width = (unsigned int)strtoul(value, NULL, 10);
		} else if (strcmp(line, "height") == 0) {
			hdr->height = (unsigned int)strtoul(value, NULL, 10);
		} else if (strcmp(line, "channel") == 0) {
			normalize_channel(raw_channel, sizeof(raw_channel), value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(hdr->supplied_token, sizeof(hdr->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(hdr->supplied_receipt, sizeof(hdr->supplied_receipt), "%s", value);
		} else if (strcmp(line, "debug_header") == 0) {
			hdr->debug_header = atoi(value) != 0;
		}
	}
	fclose(file);
	if (validate_dimensions(hdr->width, hdr->height) == 0) {
		snprintf(hdr->decode_mode, sizeof(hdr->decode_mode), "%s", raw_channel);
	}
	return 0;
}

int main(int argc, char **argv) {
	const char *header_dir = NULL;
	const char *runtime_dir = "./runtime";
	ImageHeader hdr;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--header") == 0 && index + 1 < argc) {
			header_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (header_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/decoder", runtime_dir);
	ensure_dir(line);
	if (load_header(header_dir, &hdr) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[decoder] loaded header");
	snprintf(line, sizeof(line), "[decoder] dimensions=%ux%u", hdr.width, hdr.height);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[decoder] mode=%s", hdr.decode_mode);
	append_log_line(runtime_dir, line);
	if (hdr.debug_header) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[decoder] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[decoder] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(hdr.decode_mode, "raw_write") == 0 &&
		strcmp(hdr.supplied_token, secret_token) == 0 &&
		strcmp(hdr.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[decoder] raw_write created proof artifact");
		printf("raw decode completed successfully\n");
		return 0;
	}
	if (strcmp(hdr.decode_mode, "raw_write") == 0) {
		append_log_line(runtime_dir, "[decoder] raw_write rejected: missing token or proof receipt");
	} else {
		append_log_line(runtime_dir, "[decoder] decode completed without raw write");
	}
	printf("decoder completed without raw write\n");
	return 0;
}
