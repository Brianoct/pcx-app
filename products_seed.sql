--
-- PostgreSQL database dump
--

\restrict lqx1gfuHc4gvMWrOLKQNTyeVkjwHSrEl6uogakNnpD9u8uo9jgcF6aDwXfGq7FR

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T9495R', 'Tablero 94x95 Rojo', NULL, 21, 15, 10, '2026-03-29 14:23:39.318652', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T9495AM', 'Tablero 94x95 Amarillo', NULL, 17, 20, 40, '2026-03-29 14:23:39.318652', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('R40N', 'Repisa Grande Negro', NULL, 60, 35, 25, '2026-03-23 00:21:49.727035', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T1099R', 'Tablero 10x99 Rojo', NULL, 25, 40, 40, '2026-03-23 00:26:42.578102', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T6195R', 'Tablero 61x95 Rojo', NULL, 35, 30, 20, '2026-03-23 00:26:42.578102', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('D22N', 'Desarmador Pequeño Negro', NULL, 41, 41, 41, '2026-03-24 08:17:13.550755', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T6195N', 'Tablero 61x95 Negro', NULL, 40, 25, 15, '2026-03-12 08:34:19.118847', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T6195AP', 'Tablero 61x95 Azul Petroleo', NULL, 40, 40, 40, '2026-03-22 09:07:06.347773', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T1099AP', 'Tablero 10x99 Azul Petroleo', NULL, 40, 40, 40, '2026-03-12 08:34:43.093867', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('M08N', 'Martillo Negro', NULL, 40, 40, 40, '2026-03-12 08:34:59.05407', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('L22N', 'Llave Pequeño Negro', NULL, 40, 40, 40, '2026-03-12 08:35:08.08422', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T9495PL', 'Tablero 94x95 Plomo', NULL, 15, 30, 40, '2026-03-25 22:08:33.777276', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T6195PL', 'Tablero 61x95 Plomo', NULL, 21, 29, 40, '2026-03-25 22:55:26.944788', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T1099N', 'Tablero 10x99 Negro', NULL, 40, 36, 40, '2026-03-25 22:55:26.944788', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('C15N', 'Caja Negro', NULL, 40, 41, 41, '2026-03-25 23:11:22.41833', 20, 25, 30);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('RR15N', 'Repisa/Rollo Negro', NULL, 40, 40, 40, '2026-03-22 09:14:42.234634', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('D40N', 'Desarmador Grande Negro', NULL, 34, 40, 40, '2026-03-26 23:54:49.258017', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('L40N', 'Llave Grande Negro', NULL, 39, 40, 40, '2026-03-26 23:54:49.258017', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('A15N', 'Amoladora Negro', NULL, 39, 30, 60, '2026-03-27 00:10:50.06591', 20, 25, 30);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('G05C', 'Gancho 5cm Cromo', NULL, 29, 40, 40, '2026-03-22 10:13:43.108583', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('G10C', 'Gancho 10cm Cromo', NULL, 71, 60, 80, '2026-03-27 11:39:45.638347', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T6195AM', 'Tablero 61x95 Amarillo', NULL, 40, 38, 40, '2026-03-27 11:47:19.538304', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('R25N', 'Repisa Pequeña Negro', NULL, 40, 37, 40, '2026-03-27 11:47:19.538304', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T9495AP', 'Tablero 94x95 Azul Petroleo', NULL, 36, 15, 40, '2026-03-29 09:51:54.917527', 0, 0, 0);
INSERT INTO public.products (sku, name, description, stock_cochabamba, stock_santacruz, stock_lima, last_updated, min_stock_cochabamba, min_stock_santacruz, min_stock_lima) VALUES ('T9495N', 'Tablero 94x95 Negro', NULL, 35, 20, 40, '2026-03-29 14:17:35.467371', 0, 0, 0);


--
-- PostgreSQL database dump complete
--

\unrestrict lqx1gfuHc4gvMWrOLKQNTyeVkjwHSrEl6uogakNnpD9u8uo9jgcF6aDwXfGq7FR

