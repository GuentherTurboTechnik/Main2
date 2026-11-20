CC ?= gcc
CFLAGS ?= -std=c90 -pedantic -Wall -Wextra -Wno-long-long -O2

.PHONY: test clean

test: build/host_test
	./build/host_test

build/host_test: src/gt15.c src/gt15.h src/gt15_hal.h test/host_test.c
	@mkdir -p build
	$(CC) $(CFLAGS) -Wno-declaration-after-statement -o $@ src/gt15.c test/host_test.c

clean:
	rm -rf build
