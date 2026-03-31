--
-- PostgreSQL database dump
--

\restrict vQRDog4VkfHzVJDXNbXyAwt4AD5wL4iQkPpgEfx5C41f1Te9KmI7sM2D7rMSt57

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: combo_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combo_items (
    combo_id integer NOT NULL,
    sku character varying(50) NOT NULL,
    quantity integer DEFAULT 1
);


--
-- Name: combos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combos (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    sf_price numeric(10,2) NOT NULL,
    cf_price numeric(10,2) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    created_by integer
);


--
-- Name: combos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.combos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: combos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.combos_id_seq OWNED BY public.combos.id;


--
-- Name: commission_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_settings (
    id integer DEFAULT 1 NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_settings_id_check CHECK ((id = 1))
);


--
-- Name: cupones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cupones (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    discount_percent integer NOT NULL,
    valid_until date NOT NULL,
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT cupones_discount_percent_check CHECK (((discount_percent > 0) AND (discount_percent <= 100)))
);


--
-- Name: cupones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cupones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cupones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cupones_id_seq OWNED BY public.cupones.id;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    sku character varying(50) NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    stock_cochabamba integer DEFAULT 0,
    stock_santacruz integer DEFAULT 0,
    stock_lima integer DEFAULT 0,
    last_updated timestamp without time zone DEFAULT now(),
    min_stock_cochabamba integer DEFAULT 0 NOT NULL,
    min_stock_santacruz integer DEFAULT 0 NOT NULL,
    min_stock_lima integer DEFAULT 0 NOT NULL
);


--
-- Name: quality_control_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quality_control_records (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    sku text NOT NULL,
    product_name text NOT NULL,
    quantity integer NOT NULL,
    result text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT quality_control_records_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT quality_control_records_result_check CHECK ((result = ANY (ARRAY['passed'::text, 'rejected'::text])))
);


--
-- Name: quality_control_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quality_control_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quality_control_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quality_control_records_id_seq OWNED BY public.quality_control_records.id;


--
-- Name: quality_control_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quality_control_settings (
    sku text NOT NULL,
    base_price numeric(12,2) DEFAULT 0 NOT NULL,
    commission_rate numeric(10,4) DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotes (
    id integer NOT NULL,
    user_id integer,
    customer_name character varying(255),
    customer_phone character varying(50),
    department character varying(50),
    store_location character varying(50),
    vendor character varying(50),
    venta_type character varying(2),
    discount_percent integer,
    line_items jsonb,
    subtotal numeric,
    total numeric,
    status character varying(50) DEFAULT 'draft'::character varying,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    provincia character varying(255) DEFAULT NULL::character varying,
    shipping_notes text,
    alternative_name text,
    alternative_phone text
);


--
-- Name: quotes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quotes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quotes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quotes_id_seq OWNED BY public.quotes.id;


--
-- Name: role_panel_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_panel_defaults (
    role text NOT NULL,
    panel_access jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: time_off_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_off_requests (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    leave_type text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    total_days integer NOT NULL,
    notes text,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by integer,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT time_off_requests_check CHECK ((end_date >= start_date)),
    CONSTRAINT time_off_requests_leave_type_check CHECK ((leave_type = ANY (ARRAY['vacation'::text, 'sick_leave'::text, 'early_leave'::text, 'other'::text]))),
    CONSTRAINT time_off_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT time_off_requests_total_days_check CHECK ((total_days > 0))
);


--
-- Name: time_off_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.time_off_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: time_off_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.time_off_requests_id_seq OWNED BY public.time_off_requests.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    city character varying(50),
    created_at timestamp without time zone DEFAULT now(),
    phone character varying(8) DEFAULT NULL::character varying,
    panel_access jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: combos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combos ALTER COLUMN id SET DEFAULT nextval('public.combos_id_seq'::regclass);


--
-- Name: cupones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cupones ALTER COLUMN id SET DEFAULT nextval('public.cupones_id_seq'::regclass);


--
-- Name: quality_control_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_control_records ALTER COLUMN id SET DEFAULT nextval('public.quality_control_records_id_seq'::regclass);


--
-- Name: quotes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes ALTER COLUMN id SET DEFAULT nextval('public.quotes_id_seq'::regclass);


--
-- Name: time_off_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests ALTER COLUMN id SET DEFAULT nextval('public.time_off_requests_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: combo_items combo_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_items
    ADD CONSTRAINT combo_items_pkey PRIMARY KEY (combo_id, sku);


--
-- Name: combos combos_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combos
    ADD CONSTRAINT combos_name_key UNIQUE (name);


--
-- Name: combos combos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combos
    ADD CONSTRAINT combos_pkey PRIMARY KEY (id);


--
-- Name: commission_settings commission_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_settings
    ADD CONSTRAINT commission_settings_pkey PRIMARY KEY (id);


--
-- Name: cupones cupones_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cupones
    ADD CONSTRAINT cupones_code_key UNIQUE (code);


--
-- Name: cupones cupones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cupones
    ADD CONSTRAINT cupones_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (sku);


--
-- Name: quality_control_records quality_control_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_control_records
    ADD CONSTRAINT quality_control_records_pkey PRIMARY KEY (id);


--
-- Name: quality_control_settings quality_control_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_control_settings
    ADD CONSTRAINT quality_control_settings_pkey PRIMARY KEY (sku);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: role_panel_defaults role_panel_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_panel_defaults
    ADD CONSTRAINT role_panel_defaults_pkey PRIMARY KEY (role);


--
-- Name: time_off_requests time_off_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_combo_items_combo_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_combo_items_combo_id ON public.combo_items USING btree (combo_id);


--
-- Name: idx_quality_control_records_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quality_control_records_created_at ON public.quality_control_records USING btree (created_at);


--
-- Name: idx_quality_control_records_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quality_control_records_sku ON public.quality_control_records USING btree (sku);


--
-- Name: idx_quality_control_records_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quality_control_records_user_id ON public.quality_control_records USING btree (user_id);


--
-- Name: idx_quotes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_created_at ON public.quotes USING btree (created_at);


--
-- Name: idx_quotes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_status ON public.quotes USING btree (status);


--
-- Name: idx_quotes_store_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_store_location ON public.quotes USING btree (store_location);


--
-- Name: idx_quotes_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_vendor ON public.quotes USING btree (vendor);


--
-- Name: idx_time_off_requests_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_off_requests_start_date ON public.time_off_requests USING btree (start_date);


--
-- Name: idx_time_off_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_off_requests_status ON public.time_off_requests USING btree (status);


--
-- Name: idx_time_off_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_time_off_requests_user_id ON public.time_off_requests USING btree (user_id);


--
-- Name: combo_items combo_items_combo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_items
    ADD CONSTRAINT combo_items_combo_id_fkey FOREIGN KEY (combo_id) REFERENCES public.combos(id) ON DELETE CASCADE;


--
-- Name: combos combos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combos
    ADD CONSTRAINT combos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: cupones cupones_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cupones
    ADD CONSTRAINT cupones_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: quality_control_records quality_control_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quality_control_records
    ADD CONSTRAINT quality_control_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: time_off_requests time_off_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: time_off_requests time_off_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_off_requests
    ADD CONSTRAINT time_off_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict vQRDog4VkfHzVJDXNbXyAwt4AD5wL4iQkPpgEfx5C41f1Te9KmI7sM2D7rMSt57

